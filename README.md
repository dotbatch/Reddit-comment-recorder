# Reddit Comment Recorder

Browser-console scripts that save a Reddit comment thread as a clean, correctly nested, plain-text transcript. When they finish, the transcript is copied to your clipboard.

They're useful for long threads where Reddit loads replies lazily, removes older ones from the page as you scroll, and moves deep branches onto separate pages, which makes copy-paste unreliable.

## Which script should I use?

| Script | How it works | Best for |
| --- | --- | --- |
| [`recorder-api.js`](recorder-api.js) | Downloads the comment and **every** reply beneath it from Reddit's JSON endpoints. No clicking. | Capturing a large branch completely, including every "N more replies" and "Continue this thread". **Start here.** |
| [`recorder-plus.js`](recorder-plus.js) | Records what loads on the page while you browse. You can pick any comment, keep recording across page changes, and optionally have it click "more replies" for you. | When you'd rather browse the thread yourself, or if the API script is blocked. |
| [`script.js`](script.js) | The original. Records the first top-level comment while you click "More replies". | Quick captures of small threads. |

### Why branches go missing

Past a certain depth, Reddit stops nesting replies on the page. **"43 more replies" becomes a link that opens a new page** instead of loading replies in place. The new page wipes out any script running in the console, and the original `script.js` then starts over from the first top-level comment on the new page, which sends the recording off down a different branch.

- `recorder-api.js` avoids this by fetching those branches directly. You never leave the page.
- `recorder-plus.js` saves its progress, so you can follow the link, run the script again, and it **adds** the new comments to the same recording.

## Requirements

- A desktop browser with developer tools (Chrome, Edge, Firefox, etc.).
- The current Reddit web interface (`www.reddit.com`). Old Reddit (`old.reddit.com`) is not supported.

## Running a script

1. Open the developer console:
   - **Windows/Linux:** `F12` or `Ctrl + Shift + J`
   - **macOS:** `Cmd + Option + J`
2. Paste the whole script into the console and press **Enter**.
   - Chrome may ask you to type `allow pasting` before it accepts pasted code the first time.

### Choosing which comment to record

Both new scripts let you choose the starting comment in either of two ways:

- **Open the comment's permalink.** Click its timestamp or **Share → Copy link** and open that link. Then run the script, and it uses that comment automatically.
- **Alt+Click the comment.** Run the script on any page of the post, then hold **Alt** (**Option** on macOS) and click the comment you want.

The recording includes that comment and everything beneath it. Nothing from other threads is included.

---

## `recorder-api.js`: download a whole branch

1. Open the post (or the comment's permalink) and run the script.
2. If you're not on a permalink, **Alt+Click** the comment you want.
3. Wait. The console shows progress:
   ```text
   +38 | Total: 412 | Queue: 6 | Requests: 14
   ```
4. When you see **DOWNLOAD COMPLETE**, the transcript is on your clipboard.

The script follows every "N more replies" and "Continue this thread" until the branch is fully downloaded. Requests are spaced out (`REQUEST_DELAY`, 1.2 seconds by default) to stay under Reddit's rate limits. If Reddit returns "too many requests", the script waits and tries again. A branch with several thousand replies can take a few minutes. Run `redditRecorder.stop()` to finish early and keep what has been downloaded so far.

**Settings** (top of the file):

| Setting | Default | Description |
| --- | --- | --- |
| `TARGET` | `""` | Optional comment permalink URL. If set, it takes priority over the current page. |
| `SORT` | `"old"` | Reply order: `old`, `top`, `new`, `confidence`, or `controversial` |
| `REQUEST_DELAY` | `1200` | Milliseconds between requests |
| `MAX_REQUESTS` | `1000` | Safety cap on the number of requests |

> **Note:** This script makes requests to `reddit.com` from your browser, using your logged-in session, the same way the page itself loads comments. It reads data only and never posts, votes, or changes anything.

---

## `recorder-plus.js`: record while you browse

1. Open the comment's permalink and run the script, or run it anywhere on the post and **Alt+Click** a comment.
2. Click **"More replies"** on the branches you want. Every comment that loads is recorded.
3. When a branch says **"N more replies"** or **"Continue this thread"** and opens a new page:
   1. Click it. The recording on the old page ends, but **its progress is saved**.
   2. On the new page, paste and run the script again. You'll see **RESUMING RECORDING**, and the new comments are added to the same tree.
4. After 15 seconds with no clicks and no new comments, recording stops. The **whole** recording so far, including comments from earlier pages, is copied to your clipboard.

When it finishes, the script also lists any deep-branch links you haven't opened yet. Open each one and run the script again to fill in those branches.

**Hands-free mode:** set `AUTO_EXPAND = true` at the top of the file, and the script clicks the in-page "more replies" buttons for you, one every 1.5 seconds. It never follows links to other pages. Those are listed at the end for you to open.

**Settings** (top of the file):

| Setting | Default | Description |
| --- | --- | --- |
| `IDLE_TIMEOUT` | `15000` | Milliseconds of inactivity before recording stops |
| `SCAN_INTERVAL` | `250` | How often (in ms) the page is rescanned |
| `AUTO_EXPAND` | `false` | Click in-page "more replies" buttons automatically |
| `CLICK_DELAY` | `1500` | Milliseconds between automatic clicks |

**Starting over:** Alt+Click any comment to start a new recording from it, or run `redditRecorder.reset()` to clear the saved session. A saved session only resumes on the same post, so opening a different post starts fresh automatically.

---

## `script.js`: original recorder

1. Open the post and run the script. It records the **first top-level comment** on the page and all of its replies.
2. Click **"More replies"** to load more. A five-second countdown restarts every time you click or new comments appear.
3. When the countdown runs out, the transcript is copied to your clipboard.

To allow more time between clicks, change `IDLE_TIMEOUT = 5000` at the top of the file (for example, to `15000`). This script doesn't survive page changes. Use one of the scripts above for deep threads.

---

## Example output

All three scripts produce the same format. Each nesting level adds four spaces of indentation.

```text
UserA [Score: 150]
Original top-level comment.

    UserB [Score: 42]
    Reply to UserA.

        UserC [Score: 12]
        Reply to UserB.

            UserD [Score: 5]
            Reply to UserC.

    UserE [Score: 28]
    Another reply to UserA.
```

Nesting is rebuilt from Reddit's comment IDs and parent IDs, not from visual indentation. If a reply's parent was never captured, it's listed at the end under `--- Unattached replies ---` so nothing is lost.

## Console commands

| Command | Available in | Purpose |
| --- | --- | --- |
| `redditRecorder.stop()` | all | Stop now and output what has been captured |
| `redditRecorder.count` | `plus`, original | Current number of unique comments |
| `redditRecorder.links` | `plus` | Deep-branch links you haven't opened yet |
| `redditRecorder.reset()` | `plus` | Clear the saved session |

After recording finishes:

| Command | Purpose |
| --- | --- |
| `copy(redditCommentsText)` | Copy the formatted transcript again |
| `console.table(redditComments)` | View every captured comment as a table |
| `copy(JSON.stringify(redditCommentsTree, null, 2))` | Copy the thread as nested JSON |
| `redditCommentsMap` | Inspect the raw deduplicated `Map` |

Each comment looks like this:

```js
{
  id: "t1_abc123",
  parentId: "t1_xyz789",   // null for the root comment
  username: "UserB",
  comment: "Reply to UserA.",
  score: 42,
  replies: [ /* only in redditCommentsTree */ ]
}
```

## Limitations

- **Depends on Reddit.** The page scripts read Reddit's `shreddit-comment` elements, and the API script uses Reddit's `.json` and `/api/morechildren` endpoints. Changes on Reddit's side may break them.
- **Deleted or removed comments** show as `[deleted]` / `[removed]` or have no text.
- **Scores may be hidden** on new comments in some subreddits. These show as `[Score: ?]`.
- **Clipboard copy** uses the console's built-in `copy()` helper. If copying fails, the transcript is still printed to the console and saved in `redditCommentsText`.
- **Browser storage limit:** `recorder-plus.js` saves to `localStorage`, which allows about 5 MB per site. That's enough for many thousands of comments.
