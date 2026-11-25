// Reddit Comment Recorder+ (DOM version)
// - Pick any comment as the thread root (Alt+Click it, or open its permalink).
// - Survives page changes: progress is saved to localStorage, so you can follow
//   "N more replies" / "Continue this thread" links and re-run the script to keep going.
// - Optional AUTO_EXPAND clicks in-page "more replies" buttons for you.

(() => {
    // ===== Configuration =====
    const IDLE_TIMEOUT = 15000;   // ms of inactivity before recording stops
    const SCAN_INTERVAL = 250;    // ms between page scans
    const AUTO_EXPAND = false;    // true = click in-page "more replies" buttons automatically
    const CLICK_DELAY = 1500;     // ms between automatic clicks
    const STORAGE_KEY = "redditRecorder:session";

    const copyText = typeof copy === "function" ? copy : null;

    // Stop an existing recorder without printing output.
    window.redditRecorder?.stop?.({ quiet: true });

    // ----- Session state -----
    let rootId = null;
    let comments = new Map();
    let deepLinks = new Map();   // commentId -> absolute URL of a branch on another page
    let visited = new Set();     // comment IDs whose permalink page we've recorded on

    let running = true;
    let dirty = false;
    let lastActivity = Date.now();
    let lastAutoClick = 0;
    let lastCountdown;
    let interval;
    let observer;
    const clicked = new WeakSet();

    const urlCommentId = (() => {
        const m = location.pathname.match(/\/comment\/([a-z0-9]+)/i);
        return m ? `t1_${m[1]}` : null;
    })();

    const postId = (location.pathname.match(/\/comments\/([a-z0-9]+)/i) || [])[1] || null;

    function loadSession() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY));
        } catch {
            return null;
        }
    }

    function saveSession() {
        if (!rootId) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                rootId,
                postId,
                comments: [...comments],
                deepLinks: [...deepLinks],
                visited: [...visited],
                updated: Date.now()
            }));
            dirty = false;
        } catch (err) {
            console.warn("Could not save session:", err);
        }
    }

    function startSession(id) {
        rootId = id;
        comments = new Map();
        deepLinks = new Map();
        visited = new Set();
        if (urlCommentId) visited.add(urlCommentId);
        lastActivity = Date.now();
        lastCountdown = undefined;
        dirty = true;
    }

    // ----- DOM helpers -----
    function getId(el) {
        return el?.getAttribute("thingid") || el?.id || null;
    }

    function getParentId(el) {
        return el.getAttribute("parentid") ||
            getId(el.parentElement?.closest("shreddit-comment"));
    }

    function getCommentBody(el) {
        const id = getId(el);
        const body =
            el.querySelector(':scope > [slot="comment"]') ||
            el.querySelector(':scope > [slot="comment-content"]') ||
            document.getElementById(`${id}-comment-rtjson-content`) ||
            [...el.querySelectorAll('[slot="comment-content"], .md, .md-container')]
                .find(node => node.closest("shreddit-comment") === el);
        return (body?.innerText || body?.textContent || "").trim();
    }

    function commentIdFromHref(href) {
        const m = href && href.match(/\/comment\/([a-z0-9]+)/i);
        return m ? `t1_${m[1]}` : null;
    }

    // ----- Scanning -----
    function scan() {
        if (!running || !rootId) return;

        const elements = [...document.querySelectorAll("shreddit-comment")];
        let added = 0;
        let changed = true;

        while (changed) {
            changed = false;

            for (const el of elements) {
                const id = getId(el);
                if (!id) continue;

                const parentId = getParentId(el);
                const existing = comments.get(id);

                const belongs =
                    id === rootId ||
                    existing ||
                    (parentId && comments.has(parentId)) ||
                    el.closest(`shreddit-comment[thingid="${rootId}"]`);

                if (!belongs) continue;

                const body = getCommentBody(el);
                const data = {
                    id,
                    // Keep the first parent we saw; permalink pages can misreport it.
                    parentId: id === rootId ? null : (existing?.parentId ?? parentId),
                    username: el.getAttribute("author") || existing?.username || "[deleted]",
                    comment: body || existing?.comment || "",
                    score: el.getAttribute("score") ?? existing?.score ?? null
                };

                if (!existing) {
                    comments.set(id, data);
                    added++;
                    changed = true;
                    dirty = true;
                } else if (
                    data.comment !== existing.comment ||
                    data.score !== existing.score
                ) {
                    if (data.comment !== existing.comment) lastActivity = Date.now();
                    comments.set(id, data);
                    dirty = true;
                }
            }
        }

        findDeepLinks();

        if (added > 0) {
            lastActivity = Date.now();
            console.log(`+${added} new comments | Total: ${comments.size}`);
        }
    }

    const MORE_RE = /more repl|load more|view more|continue this thread/i;

    function moreControls() {
        return [...document.querySelectorAll("button, a, [role='button']")]
            .filter(el => {
                const text = (el.innerText || el.textContent || "").trim();
                if (!text || text.length > 50 || !MORE_RE.test(text)) return false;
                const owner = getId(el.closest("shreddit-comment"));
                return owner && comments.has(owner);
            });
    }

    // Links that open a branch on a separate page (Reddit's depth limit).
    function findDeepLinks() {
        for (const el of moreControls()) {
            if (el.tagName !== "A") continue;
            const href = el.href;
            const id = commentIdFromHref(href);
            if (id && !deepLinks.has(id)) {
                deepLinks.set(id, href);
                dirty = true;
            }
        }
    }

    function autoExpand() {
        if (!AUTO_EXPAND || !rootId) return;
        if (Date.now() - lastAutoClick < CLICK_DELAY) return;

        const button = moreControls().find(el => el.tagName !== "A" && !clicked.has(el));
        if (!button) return;

        clicked.add(button);
        lastAutoClick = Date.now();
        lastActivity = Date.now();
        button.scrollIntoView({ block: "center" });
        button.click();
        console.log(`Auto-expanded: "${(button.innerText || "").trim()}"`);
    }

    // ----- Output -----
    function buildTree() {
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

        const tree = build(rootId, 0);
        const orphans = [...comments.values()].filter(c => !seen.has(c.id));
        return { tree, orphans };
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

    function pendingLinks() {
        // Branches on other pages we haven't visited yet.
        return [...deepLinks]
            .filter(([id]) => !visited.has(id))
            .map(([, href]) => href);
    }

    function stop({ quiet = false } = {}) {
        if (!running) return;
        scan();
        running = false;

        clearInterval(interval);
        observer?.disconnect();
        document.removeEventListener("click", onClick, true);
        saveSession();

        if (quiet || !rootId) return;

        const { tree, orphans } = buildTree();
        let output = formatTree(tree);

        if (orphans.length) {
            output += "\n\n--- Unattached replies ---\n\n";
            output += orphans.map(c => `${c.username}: ${c.comment}`).join("\n\n");
        }

        window.redditComments = [...comments.values()];
        window.redditCommentsMap = comments;
        window.redditCommentsTree = tree;
        window.redditCommentsText = output;

        console.log("%c RECORDING COMPLETE ", "background: green; color: white; font-size: 16px;");
        console.log(`Unique comments: ${comments.size}`);
        console.log(`Unattached replies: ${orphans.length}`);
        console.log(output);

        const pending = pendingLinks();
        if (pending.length) {
            console.log(
                `%c ${pending.length} branch(es) continue on another page. ` +
                "Open each link, then run this script again to add them: ",
                "background: #b45309; color: white;"
            );
            pending.forEach(href => console.log(href));
        }

        if (copyText) {
            copyText(output);
            console.log("Copied to clipboard!");
        }
    }

    function reset() {
        stop({ quiet: true });
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        console.log("Session cleared. Run the script again to start a new recording.");
    }

    // ----- Events -----
    function onClick(e) {
        if (!running) return;

        // Alt+Click a comment to make it the new root.
        if (e.altKey) {
            const el = e.target.closest?.("shreddit-comment");
            const id = getId(el);
            if (!id) return;
            e.preventDefault();
            e.stopPropagation();
            startSession(id);
            console.log(
                "%c NEW RECORDING ",
                "background: #2563eb; color: white; font-size: 16px;",
                "Root:", el.getAttribute("author")
            );
            scan();
            return;
        }

        lastActivity = Date.now();
        lastCountdown = undefined;
    }

    // ----- Start -----
    const saved = loadSession();
    const canResume =
        saved?.rootId &&
        saved.postId === postId &&
        (!urlCommentId || saved.comments.some(([id]) => id === urlCommentId));

    if (canResume) {
        rootId = saved.rootId;
        comments = new Map(saved.comments);
        deepLinks = new Map(saved.deepLinks || []);
        visited = new Set(saved.visited || []);
        if (urlCommentId) visited.add(urlCommentId);
        console.log(
            "%c RESUMING RECORDING ",
            "background: #2563eb; color: white; font-size: 16px;",
            `${comments.size} comments already saved`
        );
    } else if (urlCommentId && document.querySelector(`shreddit-comment[thingid="${urlCommentId}"]`)) {
        startSession(urlCommentId);
        console.log(
            "%c RECORDING STARTED ",
            "background: #2563eb; color: white; font-size: 16px;",
            "Root: comment from URL"
        );
    } else {
        console.log(
            "%c READY ",
            "background: #2563eb; color: white; font-size: 16px;",
            "Alt+Click the comment you want to record."
        );
    }

    console.log(
        AUTO_EXPAND
            ? "Expanding replies automatically."
            : 'Click "more replies" to load comments.'
    );
    console.log(`Recording stops after ${IDLE_TIMEOUT / 1000}s of inactivity. Alt+Click any comment to start over from it.`);

    document.addEventListener("click", onClick, true);
    observer = new MutationObserver(() => scan());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    window.redditRecorder = {
        stop,
        scan,
        reset,
        get comments() { return comments; },
        get count() { return comments.size; },
        get links() { return pendingLinks(); }
    };

    scan();

    interval = setInterval(() => {
        scan();
        autoExpand();
        if (dirty) saveSession();

        if (!rootId) return;   // still waiting for Alt+Click

        const remaining = Math.ceil((IDLE_TIMEOUT - (Date.now() - lastActivity)) / 1000);
        if (remaining <= 0) {
            stop();
            return;
        }
        if (remaining !== lastCountdown) {
            lastCountdown = remaining;
            if (remaining <= 5) {
                console.log(`Recording: ${comments.size} comments | Stopping in ${remaining}s unless activity detected`);
            }
        }
    }, SCAN_INTERVAL);
})();
