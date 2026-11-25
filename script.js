
(() => {
    // Configuration
    const IDLE_TIMEOUT = 5000;
    const SCAN_INTERVAL = 250;

    // Stop an existing recorder if one is running.
    window.redditRecorder?.stop?.();

    const root =
        document.querySelector('shreddit-comment[depth="0"]') ||
        document.querySelector("shreddit-comment");

    if (!root) {
        console.error("No top-level comment found.");
        return;
    }

    const rootId = root.getAttribute("thingid");
    const comments = new Map();

    let lastActivity = Date.now();
    let running = true;
    let interval;
    let observer;
    let lastCountdown;

    const copyText = typeof copy === "function" ? copy : null;

    function getId(el) {
        return el.getAttribute("thingid") || el.id;
    }

    function getParentId(el) {
        return el.getAttribute("parentid") ||
            getId(el.parentElement?.closest("shreddit-comment") || el);
    }

    function getCommentBody(el) {
        const id = getId(el);

        const body =
            el.querySelector(':scope > [slot="comment"]') ||
            el.querySelector(':scope > [slot="comment-content"]') ||
            document.getElementById(`${id}-comment-rtjson-content`) ||
            [...el.querySelectorAll(
                '[slot="comment-content"], .md, .md-container'
            )].find(node =>
                node.closest("shreddit-comment") === el
            );

        return (
            body?.innerText ||
            body?.textContent ||
            ""
        ).trim();
    }

    function scan() {
        if (!running) return;

        const elements = [
            ...document.querySelectorAll("shreddit-comment")
        ];

        let added = 0;
        let changed = true;

        // Repeat until all reachable descendants are captured.
        while (changed) {
            changed = false;

            for (const el of elements) {
                const id = getId(el);
                const parentId = getParentId(el);

                if (!id) continue;

                const belongsToThread =
                    id === rootId ||
                    comments.has(id) ||
                    comments.has(parentId) ||
                    el.closest(
                        `shreddit-comment[thingid="${rootId}"]`
                    );

                if (!belongsToThread) continue;

                const body = getCommentBody(el);
                const existing = comments.get(id);

                const data = {
                    id,
                    parentId: id === rootId ? null : parentId,
                    username:
                        el.getAttribute("author") || "[deleted]",
                    comment: body || existing?.comment || "",
                    score: el.getAttribute("score"),
                    depth: Number(el.getAttribute("depth") || 0)
                };

                if (!existing) {
                    comments.set(id, data);
                    added++;
                    changed = true;
                } else {
                    if (data.comment !== existing.comment) {
                        lastActivity = Date.now();
                    }

                    comments.set(id, data);
                }
            }
        }

        if (added > 0) {
            lastActivity = Date.now();

            console.log(
                `+${added} new comments | Total: ${comments.size}`
            );
        }
    }

    function buildTree() {
        const children = new Map();

        for (const comment of comments.values()) {
            if (!children.has(comment.parentId)) {
                children.set(comment.parentId, []);
            }

            children.get(comment.parentId).push(comment);
        }

        const visited = new Set();

        function build(id, depth = 0) {
            if (visited.has(id)) return null;

            const comment = comments.get(id);
            if (!comment) return null;

            visited.add(id);

            return {
                ...comment,
                depth,
                replies: (children.get(id) || [])
                    .map(child => build(child.id, depth + 1))
                    .filter(Boolean)
            };
        }

        const tree = build(rootId);

        const orphans = [...comments.values()]
            .filter(c => !visited.has(c.id));

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

        return [
            text,
            ...node.replies.map(formatTree)
        ].join("\n\n");
    }

    function onClick() {
        if (!running) return;

        lastActivity = Date.now();
        lastCountdown = undefined;
    }

    function stop() {
        if (!running) return;

        scan();
        running = false;

        clearInterval(interval);
        observer?.disconnect();

        document.removeEventListener("click", onClick, true);

        const { tree, orphans } = buildTree();

        let output = formatTree(tree);

        if (orphans.length) {
            output += "\n\n--- Unattached replies ---\n\n";
            output += orphans.map(c =>
                `${c.username}: ${c.comment}`
            ).join("\n\n");
        }

        window.redditComments = [...comments.values()];
        window.redditCommentsMap = comments;
        window.redditCommentsTree = tree;
        window.redditCommentsText = output;

        console.log(
            "%c RECORDING COMPLETE ",
            "background: green; color: white; font-size: 16px;"
        );

        console.log(`Unique comments: ${comments.size}`);
        console.log(`Unattached replies: ${orphans.length}`);
        console.log(output);

        if (copyText) {
            copyText(output);
            console.log("Copied to clipboard!");
        }
    }

    document.addEventListener("click", onClick, true);

    observer = new MutationObserver(() => {
        scan();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    window.redditRecorder = {
        stop,
        scan,
        comments,
        get count() {
            return comments.size;
        }
    };

    console.log(
        "%c RECORDING STARTED ",
        "background: #2563eb; color: white; font-size: 16px;"
    );

    console.log("Target:", root.getAttribute("author"));
    console.log("Manually click More replies.");
    console.log("Recording stops after 5 seconds of inactivity.");

    scan();

    interval = setInterval(() => {
        scan();

        const remaining = Math.ceil(
            (IDLE_TIMEOUT - (Date.now() - lastActivity)) / 1000
        );

        if (remaining <= 0) {
            stop();
            return;
        }

        if (remaining !== lastCountdown) {
            lastCountdown = remaining;

            console.log(
                `Recording: ${comments.size} comments | ` +
                `Stopping in ${remaining}s unless activity detected`
            );
        }
    }, SCAN_INTERVAL);
})();
