// Reddit Comment Recorder (API version)
// Downloads a comment and its ENTIRE reply tree using Reddit's public JSON endpoints,
// including every "N more replies" and "Continue this thread" branch.
// No clicking or scrolling needed.
//
// Target (first match wins):
//   1. TARGET below (a comment permalink URL), if set
//   2. The current page, if it is a comment permalink (.../comment/<id>/)
//   3. Otherwise, Alt+Click the comment you want after running the script

(async () => {
    // ===== Configuration =====
    const TARGET = "";            // optional comment permalink URL
    const SORT = "old";           // "old", "top", "new", "confidence", "controversial"
    const REQUEST_DELAY = 1200;   // ms between requests (be gentle; Reddit rate-limits)
    const MAX_REQUESTS = 1000;    // safety cap

    const copyText = typeof copy === "function" ? copy : null;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    window.redditRecorder?.stop?.({ quiet: true });

    let cancelled = false;
    window.redditRecorder = {
        stop() {
            cancelled = true;
            console.log("Stopping after the current request...");
        }
    };

    // ----- Pick the target comment -----
    function parseUrl(url) {
        const m = url.match(/\/comments\/([a-z0-9]+)\/.*?\/comment\/([a-z0-9]+)/i) ||
                  url.match(/\/comments\/([a-z0-9]+)\/[^/]*\/([a-z0-9]+)/i);
        return m ? { postId: m[1], commentId: m[2] } : null;
    }

    function waitForAltClick() {
        console.log(
            "%c READY ",
            "background: #2563eb; color: white; font-size: 16px;",
            "Alt+Click the comment you want to download."
        );
        return new Promise(resolve => {
            function handler(e) {
                if (!e.altKey) return;
                const el = e.target.closest?.("shreddit-comment");
                const thingId = el?.getAttribute("thingid");
                if (!thingId) return;
                e.preventDefault();
                e.stopPropagation();
                document.removeEventListener("click", handler, true);
                const postAttr = el.getAttribute("postid") || "";
                resolve({
                    postId: postAttr.replace(/^t3_/, "") ||
                        (location.pathname.match(/\/comments\/([a-z0-9]+)/i) || [])[1],
                    commentId: thingId.replace(/^t1_/, "")
                });
            }
            document.addEventListener("click", handler, true);
        });
    }

    const target =
        (TARGET && parseUrl(TARGET)) ||
        parseUrl(location.pathname) ||
        await waitForAltClick();

    if (!target?.postId || !target?.commentId) {
        console.error("Could not determine the post/comment ID.");
        return;
    }

    const rootId = `t1_${target.commentId}`;
    const linkId = `t3_${target.postId}`;

    // ----- Networking -----
    let requests = 0;
    let lastRequest = 0;

    async function getJSON(url) {
        for (let attempt = 1; attempt <= 5; attempt++) {
            if (requests >= MAX_REQUESTS) throw new Error("MAX_REQUESTS reached");

            const wait = lastRequest + REQUEST_DELAY - Date.now();
            if (wait > 0) await sleep(wait);
            lastRequest = Date.now();
            requests++;

            const res = await fetch(url, { credentials: "include" });

            if (res.status === 429) {
                const retry = (Number(res.headers.get("retry-after")) || 10 * attempt) * 1000;
                console.warn(`Rate limited. Waiting ${retry / 1000}s...`);
                await sleep(retry);
                continue;
            }
            if (!res.ok) {
                if (attempt < 5 && res.status >= 500) {
                    await sleep(2000 * attempt);
                    continue;
                }
                throw new Error(`HTTP ${res.status} for ${url}`);
            }
            return res.json();
        }
        throw new Error(`Gave up on ${url}`);
    }

    // ----- Collection -----
    const comments = new Map();
    const queue = [];          // pending { type: "more", ids, parentId } | { type: "continue", parentId }
    const queuedContinue = new Set();

    function addComment(d) {
        comments.set(d.name, {
            id: d.name,
            parentId: d.name === rootId ? null : d.parent_id,
            username: d.author || "[deleted]",
            comment: d.body ?? "",
            score: d.score_hidden ? null : d.score,
            created: d.created_utc
        });
    }

    function walk(thing) {
        if (!thing) return;

        if (thing.kind === "t1") {
            addComment(thing.data);
            for (const child of thing.data.replies?.data?.children || []) {
                walk(child);
            }
        } else if (thing.kind === "more") {
            const { children = [], parent_id, count } = thing.data;
            if (children.length) {
                queue.push({ type: "more", ids: children, parentId: parent_id });
            } else if (!count || thing.data.id === "_") {
                // "Continue this thread": replies only available from the parent's permalink.
                if (!queuedContinue.has(parent_id)) {
                    queuedContinue.add(parent_id);
                    queue.push({ type: "continue", parentId: parent_id });
                }
            }
        }
    }

    async function fetchPermalink(commentId) {
        const url =
            `${location.origin}/comments/${target.postId}/_/${commentId}/.json` +
            `?limit=500&depth=100&sort=${SORT}&raw_json=1`;
        const data = await getJSON(url);
        const listing = data?.[1]?.data?.children || [];
        const node = listing.find(t => t.kind === "t1" && t.data.id === commentId) || listing[0];
        return node;
    }

    async function fetchMore(ids) {
        const url =
            `${location.origin}/api/morechildren.json?api_type=json` +
            `&link_id=${linkId}&children=${ids.join(",")}` +
            `&sort=${SORT}&limit_children=false&raw_json=1`;
        const data = await getJSON(url);
        return data?.json?.data?.things || [];
    }

    // ----- Run -----
    console.log(
        "%c DOWNLOADING THREAD ",
        "background: #2563eb; color: white; font-size: 16px;",
        `comment ${rootId}`
    );

    let failures = 0;

    try {
        const root = await fetchPermalink(target.commentId);
        if (!root || root.kind !== "t1") throw new Error("Target comment not found.");
        walk(root);
        console.log(`Loaded ${comments.size} comments. ${queue.length} branch(es) to expand...`);

        while (queue.length && !cancelled) {
            const job = queue.shift();
            const before = comments.size;

            try {
                if (job.type === "more") {
                    // morechildren accepts at most 100 IDs per call.
                    const batch = job.ids.slice(0, 100);
                    if (job.ids.length > 100) {
                        queue.unshift({ ...job, ids: job.ids.slice(100) });
                    }
                    for (const thing of await fetchMore(batch)) walk(thing);
                } else {
                    const node = await fetchPermalink(job.parentId.replace(/^t1_/, ""));
                    for (const child of node?.data?.replies?.data?.children || []) walk(child);
                }
            } catch (err) {
                failures++;
                console.warn("Branch failed, skipping:", err.message);
            }

            console.log(
                `+${comments.size - before} | Total: ${comments.size} | ` +
                `Queue: ${queue.length} | Requests: ${requests}`
            );
        }
    } catch (err) {
        console.error(err);
        if (!comments.size) return;
        console.warn("Continuing with what was downloaded.");
    }

    // ----- Output -----
    const children = new Map();
    for (const c of comments.values()) {
        if (!children.has(c.parentId)) children.set(c.parentId, []);
        children.get(c.parentId).push(c);
    }

    const seen = new Set();
    function build(id, depth) {
        const c = comments.get(id);
        if (!c || seen.has(id)) return null;
        seen.add(id);
        return {
            ...c,
            depth,
            replies: (children.get(id) || [])
                .map(child => build(child.id, depth + 1))
                .filter(Boolean)
        };
    }

    function formatTree(node) {
        if (!node) return "";
        const indent = "    ".repeat(node.depth);
        const text = [
            `${indent}${node.username} [Score: ${node.score ?? "?"}]`,
            ...(node.comment || "[Comment text unavailable]")
                .split("\n")
                .map(line => indent + line)
        ].join("\n");
        return [text, ...node.replies.map(formatTree)].join("\n\n");
    }

    const tree = build(rootId, 0);
    const orphans = [...comments.values()].filter(c => !seen.has(c.id));

    let output = formatTree(tree);
    if (orphans.length) {
        output += "\n\n--- Unattached replies ---\n\n";
        output += orphans.map(c => `${c.username}: ${c.comment}`).join("\n\n");
    }

    window.redditComments = [...comments.values()];
    window.redditCommentsMap = comments;
    window.redditCommentsTree = tree;
    window.redditCommentsText = output;

    console.log("%c DOWNLOAD COMPLETE ", "background: green; color: white; font-size: 16px;");
    console.log(`Unique comments: ${comments.size}`);
    console.log(`Requests: ${requests} | Failed branches: ${failures}${cancelled ? " | Stopped early" : ""}`);
    console.log(output);

    try {
        if (copyText) {
            copyText(output);
            console.log("Copied to clipboard!");
        } else {
            await navigator.clipboard.writeText(output);
            console.log("Copied to clipboard!");
        }
    } catch {
        console.log("Clipboard copy failed. Run: copy(redditCommentsText)");
    }
})();
