# Changelog

## 0.16.4 - 2026-11-18

- **Upstream 0.16.2 on the fork channel:** Integrates [upstream 0.16.2](https://github.com/getpaseo/paseo/releases/tag/v0.16.2) while keeping this fork's custom behavior.
- **Preserved fork behavior:** Math rendering and copy, phone 12/24-hour clock preferences, Claude 200K and `[1m]` variants, per-model controls, Codex follow-ups during `/goal` turns, Expo push recovery, session usage metrics, shared-login account reconciliation, GitHub Desktop/Android updater targets, the remote-host CLI archive, and Vitest browser CI fixes.
- **Downloads:** [derrickzhde/paseo releases](https://github.com/derrickzhde/paseo/releases).

## 0.16.2 - 2026-11-18

### Fixed

- Fixed Collapse turns hiding a finished reply when Claude answers a later background task notification ([#10092](https://github.com/getpaseo/paseo/pull/10092))
- Fixed detached worktree commits getting lost when archiving a workspace ([#10009](https://github.com/getpaseo/paseo/pull/10009) by [@ragokan](https://github.com/ragokan))
- Fixed Desktop updates leaving an older daemon running when an earlier Desktop session started it ([#10067](https://github.com/getpaseo/paseo/pull/10067))
- Fixed daemons losing their Hub connection after execution permissions changed ([#10113](https://github.com/getpaseo/paseo/pull/10113))
- Fixed saved hosts disappearing when one stored entry could not be read ([#9847](https://github.com/getpaseo/paseo/pull/9847) by [@ragokan](https://github.com/ragokan))
- Fixed worktree creation timing out while scanning large ignored folders that `.worktreeinclude` does not name ([#10020](https://github.com/getpaseo/paseo/pull/10020) by [@mgranderath](https://github.com/mgranderath))
- Fixed Steer cancelling a Claude compaction in progress ([#10028](https://github.com/getpaseo/paseo/pull/10028) by [@NightMachinery](https://github.com/NightMachinery))
- Fixed agents getting stuck after a second Stop when the provider reused the cancelled turn ID ([#9774](https://github.com/getpaseo/paseo/pull/9774) by [@DAnaeto](https://github.com/DAnaeto))
- Fixed Desktop staying blank after its renderer exited unexpectedly ([#10035](https://github.com/getpaseo/paseo/pull/10035))
- Fixed failed file downloads taking over the app window on web and Desktop ([#9937](https://github.com/getpaseo/paseo/pull/9937) by [@panta82](https://github.com/panta82))
- Fixed Import Session losing its scroll position when you select Load more ([#9974](https://github.com/getpaseo/paseo/pull/9974))
- Fixed terminals failing to open when the home filesystem refuses Unix sockets, such as on AFS ([#9214](https://github.com/getpaseo/paseo/pull/9214) by [@bendavid](https://github.com/bendavid))
- Fixed timed-out Git watchers repeatedly rescanning large repositories ([#9828](https://github.com/getpaseo/paseo/pull/9828) by [@Spshulem](https://github.com/Spshulem))
- Fixed `paseo workspace create --path .` using the local daemon's directory instead of the caller's ([#10010](https://github.com/getpaseo/paseo/pull/10010))
- Fixed MCP agent status and list responses omitting background work for idle agents ([#10022](https://github.com/getpaseo/paseo/pull/10022) by [@ortschun](https://github.com/ortschun))
- Fixed the thinking selector showing an old level after OMP changes it ([#9841](https://github.com/getpaseo/paseo/pull/9841) by [@dsingal0](https://github.com/dsingal0))

## 0.16.1 - 2026-11-17

### Fixed

- Fixed Claude Bypass approving actions without a permission card when a `permissions.ask` rule or a hook that returns `ask` required one ([#9927](https://github.com/getpaseo/paseo/pull/9927))
- Fixed controls being touch-sized on a touch-screen laptop when a trackpad or mouse is its primary input ([#9909](https://github.com/getpaseo/paseo/pull/9909) by [@michaelhthomas](https://github.com/michaelhthomas))
- Fixed Claude sessions failing until `/login` when Paseo refreshed the Claude model list while Claude Code was renewing an expired access token ([#9855](https://github.com/getpaseo/paseo/pull/9855) by [@daysun-k](https://github.com/daysun-k))
- Fixed Add host text fields on web drawing without a box, which left the host password field invisible ([#9865](https://github.com/getpaseo/paseo/pull/9865) by [@angusb93](https://github.com/angusb93))
- Fixed an OpenCode question that could not be answered or dismissed after a new message steered the turn ([#9891](https://github.com/getpaseo/paseo/pull/9891))
- Fixed Pi and OMP model names that contain `/` being cut to the text after the last slash ([#9823](https://github.com/getpaseo/paseo/pull/9823), [#9836](https://github.com/getpaseo/paseo/pull/9836) by [@rms523](https://github.com/rms523))
- Fixed Changes leaving out an edit when the file was saved with the same size in the same second it was staged ([#9854](https://github.com/getpaseo/paseo/pull/9854))
- Fixed an error toast that never closed when marking a chat as read failed ([#9837](https://github.com/getpaseo/paseo/pull/9837))
- Fixed wait results and finish notifications after a daemon restart joining an agent's self-started reply to the reply before it ([#9846](https://github.com/getpaseo/paseo/pull/9846))
- Fixed Codex chats staying loaded in the daemon until restart when a client opened them only to read their history ([#9859](https://github.com/getpaseo/paseo/pull/9859) by [@Spshulem](https://github.com/Spshulem))

### Notes

- Fork-channel release on [derrickzhde/paseo](https://github.com/derrickzhde/paseo/releases); upstream 0.16.1 remains on [getpaseo/paseo](https://github.com/getpaseo/paseo/releases/tag/v0.16.1).

## 0.16.2 - 2026-11-16

- **Desktop release fix:** Drop the obsolete `app-builder-lib` macOS signing backport now that electron-builder 26.18.0 ships [electron-builder#10172](https://github.com/electron-userland/electron-builder/pull/10172). Restores macOS desktop packages and `latest-mac.yml` in fork releases.
- **Same fork payload as 0.16.1:** Integrates upstream 0.16.0 with this fork's preserved behavior (math rendering, clock preferences, Claude variants, usage metrics, updater targets, remote-host CLI archive, Vitest browser CI fixes). Tag `v0.16.1` did not complete publication; **use v0.16.2** for downloads and updates.
- **Downloads:** [derrickzhde/paseo releases](https://github.com/derrickzhde/paseo/releases).

### Notes

- Fork-channel release on [derrickzhde/paseo](https://github.com/derrickzhde/paseo/releases); upstream 0.16.0 remains on [getpaseo/paseo](https://github.com/getpaseo/paseo/releases/tag/v0.16.0).

## 0.16.1 - 2026-11-16

- **Unpublished:** Desktop Release failed during macOS signing preparation; do not use this tag for updates.

- **Upstream 0.16.0 on the fork channel:** Integrates [upstream 0.16.0](https://github.com/getpaseo/paseo/releases/tag/v0.16.0) — provider draft controls, built-in plugin gallery, command center tabs, and the rest of that release — while keeping this fork's custom behavior.
- **Preserved fork behavior:** Math rendering and copy, phone 12/24-hour clock preferences, Claude 200K and `[1m]` variants, session usage metrics, GitHub Desktop/Android updater targets, and the remote-host CLI archive upgrade path.
- **Downloads:** Release packages are published at [derrickzhde/paseo](https://github.com/derrickzhde/paseo/releases).

### Notes

- This is a fork-channel release on [derrickzhde/paseo](https://github.com/derrickzhde/paseo/releases); upstream 0.16.0 remains on [getpaseo/paseo](https://github.com/getpaseo/paseo/releases/tag/v0.16.0).

## 0.16.0 - 2026-11-16

- **Background tasks:** See and stop background tasks above the composer for Claude Code, Codex and OpenCode v2. ([#6220](https://github.com/getpaseo/paseo/pull/6220), [#9162](https://github.com/getpaseo/paseo/pull/9162), [#9635](https://github.com/getpaseo/paseo/pull/9635) by [@fxlelouarn](https://github.com/fxlelouarn))
- **Built-in plugin gallery:** Browse, search and install plugins without leaving Paseo. Manage their settings and updates from the same page. ([#9752](https://github.com/getpaseo/paseo/pull/9752))
- **Command center tabs:** Switch between Workspaces, Files and Actions, with recent workspaces shown first. Search now includes archived workspaces and matches agent titles within their workspace. ([#9689](https://github.com/getpaseo/paseo/pull/9689))
- **Plugin sidebar views:** Plugins can replace the sidebar with their own workspace and agent layout across connected hosts. Choose a view per device in Settings → Sidebar. ([#8906](https://github.com/getpaseo/paseo/pull/8906))
- **Plugin composer controls:** Plugins can add composer controls, edit drafts and attachments, and change agent settings. They can also add New workspace items and save metadata on agents and workspaces. ([#8744](https://github.com/getpaseo/paseo/pull/8744), [#9209](https://github.com/getpaseo/paseo/pull/9209), [#9207](https://github.com/getpaseo/paseo/pull/9207), [#9734](https://github.com/getpaseo/paseo/pull/9734) by [@michaelmwu](https://github.com/michaelmwu))
- **Arrange Usage cards:** Drag provider cards into your preferred order and turn off cards you do not want in the sidebar summary. Choose the host from Usage settings. ([#9660](https://github.com/getpaseo/paseo/pull/9660), [#9740](https://github.com/getpaseo/paseo/pull/9740), [#9748](https://github.com/getpaseo/paseo/pull/9748), [#9780](https://github.com/getpaseo/paseo/pull/9780))
- **Quieter app reopening:** Returning to an unchanged chat no longer flashes "Updating messages." Paseo keeps healthy connections open and recovers dropped connections when you return. After reconnecting, an up-to-date chat no longer shows an extra update toast. ([#9242](https://github.com/getpaseo/paseo/pull/9242), [#8651](https://github.com/getpaseo/paseo/pull/8651), [#9086](https://github.com/getpaseo/paseo/pull/9086), [#8855](https://github.com/getpaseo/paseo/pull/8855), [#9116](https://github.com/getpaseo/paseo/pull/9116), [#9558](https://github.com/getpaseo/paseo/pull/9558) by [@adamcstephens](https://github.com/adamcstephens))
- **Rebuilt mobile chat:** Expanding turn summaries, todo cards and tool groups keeps your reading position on iOS and Android. Sending during a scroll moves to the new prompt. ([#8717](https://github.com/getpaseo/paseo/pull/8717), [#9085](https://github.com/getpaseo/paseo/pull/9085), [#9806](https://github.com/getpaseo/paseo/pull/9806), [#9693](https://github.com/getpaseo/paseo/pull/9693))
- **Faster diff loading:** Changes shows the file tree before file contents finish loading. Large diffs load in batches and take priority over background worktree scans. ([#8907](https://github.com/getpaseo/paseo/pull/8907), [#9241](https://github.com/getpaseo/paseo/pull/9241), [#9243](https://github.com/getpaseo/paseo/pull/9243), [#9584](https://github.com/getpaseo/paseo/pull/9584))
- **Faster composer menus:** Command and file suggestions open sooner in large lists and stay against the composer as it changes size. ([#9657](https://github.com/getpaseo/paseo/pull/9657), [#9647](https://github.com/getpaseo/paseo/pull/9647), [#9642](https://github.com/getpaseo/paseo/pull/9642))
- **Keyboard shortcuts on mobile:** A connected keyboard gives iPad and Android the same shortcuts as desktop, including custom bindings. Shift+Tab in the iPad composer switches mode without typing a tab. ([#8625](https://github.com/getpaseo/paseo/pull/8625), [#9561](https://github.com/getpaseo/paseo/pull/9561) by [@jeroenfrenken](https://github.com/jeroenfrenken), [@lstroud](https://github.com/lstroud))
- **Touch-sized tablet controls:** Wide layouts on touch devices have larger buttons and rows. The composer folds controls into the model menu when space runs out. ([#8748](https://github.com/getpaseo/paseo/pull/8748), [#8885](https://github.com/getpaseo/paseo/pull/8885), [#8891](https://github.com/getpaseo/paseo/pull/8891), [#8909](https://github.com/getpaseo/paseo/pull/8909), [#9151](https://github.com/getpaseo/paseo/pull/9151), [#9238](https://github.com/getpaseo/paseo/pull/9238), [#8739](https://github.com/getpaseo/paseo/pull/8739) by [@zeyugao](https://github.com/zeyugao))
- **Undo workspace archive:** Restore an archived workspace with Undo or Cmd/Ctrl+Z during the six-second toast. Paseo checks for unsaved files and unpushed commits before removing a worktree. ([#8904](https://github.com/getpaseo/paseo/pull/8904), [#9104](https://github.com/getpaseo/paseo/pull/9104), [#9625](https://github.com/getpaseo/paseo/pull/9625), [#9753](https://github.com/getpaseo/paseo/pull/9753) by [@ragokan](https://github.com/ragokan))

### Added

- Added a Change base picker for worktree diffs, commits and Git actions ([#8642](https://github.com/getpaseo/paseo/pull/8642), [#8934](https://github.com/getpaseo/paseo/pull/8934) by [@Myasuka](https://github.com/Myasuka))
- Added issue and pull request links that resolve SSH aliases and fork parent repositories ([#8636](https://github.com/getpaseo/paseo/pull/8636), [#9576](https://github.com/getpaseo/paseo/pull/9576))
- Added an iPhone Duo layout with the sidebar and workspace on opposite sides of the fold ([#8741](https://github.com/getpaseo/paseo/pull/8741), [#8901](https://github.com/getpaseo/paseo/pull/8901) by [@zeyugao](https://github.com/zeyugao))
- Added fx as a provider you can add from the provider catalog in Settings → Hosts → Providers ([#9160](https://github.com/getpaseo/paseo/pull/9160))
- Added background agents that stay out of tabs, notifications and default agent lists ([#8683](https://github.com/getpaseo/paseo/pull/8683))
- Added syntax highlighting for Terraform and HCL files (`.tf`, `.tfvars`, `.hcl`) ([#9106](https://github.com/getpaseo/paseo/pull/9106))
- Added `PASEO_WORKSPACE_ID` to each agent's environment so an agent can identify, rename or archive its own workspace ([#8939](https://github.com/getpaseo/paseo/pull/8939) by [@DTTerastar](https://github.com/DTTerastar))
- Added plugin badges to sidebar workspace rows ([#7645](https://github.com/getpaseo/paseo/pull/7645) by [@jtomaszewski](https://github.com/jtomaszewski))
- Added a Download button for files without a preview ([#9640](https://github.com/getpaseo/paseo/pull/9640))
- Added Copilot premium-request usage and remaining quota to Usage ([#8489](https://github.com/getpaseo/paseo/pull/8489) by [@thisisryanswift](https://github.com/thisisryanswift))
- Added Undo when Git detects conflicts ([#9181](https://github.com/getpaseo/paseo/pull/9181))
- Added permission checks to see if users can use `/ask-agent`, `/assign` and Workspace actions ([#8638](https://github.com/getpaseo/paseo/pull/8638) by [@michaelhthomas](https://github.com/michaelhthomas))
- Added a workspace badge to plugin entries in the plugin gallery ([#9751](https://github.com/getpaseo/paseo/pull/9751))
- Added a Relay section to the host row for remote device connections ([#9614](https://github.com/getpaseo/paseo/pull/9614))
- Added host disconnection timing in the sidebar when the next background reconnection will happen ([#8847](https://github.com/getpaseo/paseo/pull/8847) by [@adam-chen](https://github.com/adam-chen))
- Added an OAuth login flow for Atlassian hosts ([#9659](https://github.com/getpaseo/paseo/pull/9659))
- Added an OAuth login flow for OpenHands ([#8991](https://github.com/getpaseo/paseo/pull/8991) by [@adam-chen](https://github.com/adam-chen))

### Changed

- Mobile layouts now pick large or small controls based on whether you last used a touch or a mouse, not the device type. Touch control sizes work on iPad with a connected mouse and on an Android device with touch and stylus input.
- The workspace switcher opens when you press ⌘K, P or Ctrl+P. Pass your query to the new All tab to search across workspaces, actions and files in one place. Type @ to switch tabs. Settings and Help actions are in the Actions tab.
- Select desktop and mobile workspace views separately in Settings → Sidebar. A workspace-only layout hides agents and the file explorer from the sidebar.
- Tabs and agent rows stay narrower on Desktop and tablet to fit a taller file list, with larger gaps on smaller screens for touch.
- Paseo now shows a warning and an upgrade instruction when the daemon is too old for the app. The desktop app upgrades its daemon during desktop updates, and a remote daemon owner controls their upgrade.
- Claude Bypass no longer requests tool approval for a Claude Code tool that may bypass permissions. Instead, it disables Bypass when tools are active.
- The active workspace badge in the sidebar stays white on narrow layouts so you can see which one is open.
- Set up and manage plugins on iPad and Android from Settings → Plugins → Manage plugins, the same way you use it on desktop.
- Hosts list connected and disconnected entries separately in the home sidebar. A remote host moves out of the Connected section during an active reconnection attempt.
- Pi response streaming no longer reveals Pi metadata keys or malformed JSON to the agent.
- The Invite link button is now next to the workspace settings menu in every layout.
- Plugin settings on mobile now list grouped settings in the same order as desktop.
- Remove workspace shows Undo even when there were no pending changes. Pressing Undo still restores the worktree and its uncommitted edits.
- Pi and OMP agent card labels use the same format as other providers.
- File download boxes stay inside the app on mobile so you can open the downloaded file right away.

### Fixed

- Fixed the keyboard showing when you tap any tab's scrollable area on iPhone, not just the draft composer ([#8825](https://github.com/getpaseo/paseo/pull/8825))
- Fixed the sidebar background flickering white when collapsing a group on iOS ([#9155](https://github.com/getpaseo/paseo/pull/9155))
- Fixed native client message deliveries dropping behind before the reconnection toast disappeared ([#9090](https://github.com/getpaseo/paseo/pull/9090))
- Fixed agent scrolling during streaming not resuming once you moved away from the writing edge ([#8956](https://github.com/getpaseo/paseo/pull/8956), [#9082](https://github.com/getpaseo/paseo/pull/9082) by [@DTTerastar](https://github.com/DTTerastar))
- Fixed the Workspaces command showing archived workspaces twice ([#9602](https://github.com/getpaseo/paseo/pull/9602))
- Fixed workspace creation not starting until the loading animation finished, even when the daemon's response had already arrived ([#9548](https://github.com/getpaseo/paseo/pull/9548) by [@linhua55](https://github.com/linhua55))
- Fixed Paseo starting new interactive agents in the background when an active agent self-steers into a new turn ([#9538](https://github.com/getpaseo/paseo/pull/9538))
- Fixed Markdown code blocks inside numbered lists losing their line breaks in native on iOS ([#9152](https://github.com/getpaseo/paseo/pull/9152))
- Fixed an iOS agent scroll jump when the keyboard closed during assistant streaming ([#9189](https://github.com/getpaseo/paseo/pull/9189))
- Fixed tabs appearing out of the navigation bar on iPhone while scrolling ([#8790](https://github.com/getpaseo/paseo/pull/8790) by [@zeyugao](https://github.com/zeyugao))
- Fixed an iOS swipe that got stuck midway while exiting the full-screen agent on iPhone, leaving the composer over the sidebar ([#8786](https://github.com/getpaseo/paseo/pull/8786))
- Fixed mobile tab bar underlines staying after you swiped away from that tab ([#8832](https://github.com/getpaseo/paseo/pull/8832) by [@zeyugao](https://github.com/zeyugao))
- Fixed iOS chat scrolling to show a tool result, then jumping back to the reading position after a message or expand ([#9088](https://github.com/getpaseo/paseo/pull/9088), [#9697](https://github.com/getpaseo/paseo/pull/9697) by [@anhmv](https://github.com/anhmv))
- Fixed collapsing summaries staying collapsed when you scroll the mobile agent timeline ([#8818](https://github.com/getpaseo/paseo/pull/8818))
- Fixed agent card kebab menus on iOS opening below the composer ([#9070](https://github.com/getpaseo/paseo/pull/9070))
- Fixed command suggestions not scrolling to the selected command after pressing Down many times ([#9637](https://github.com/getpaseo/paseo/pull/9637))
- Fixed commands that attach directories hiding the directory tree when opening the menu before streaming started ([#9638](https://github.com/getpaseo/paseo/pull/9638))
- Fixed agent cards opening web URLs without a protocol `https://` by falling back to the system browser ([#8652](https://github.com/getpaseo/paseo/pull/8652) by [@adam-chen](https://github.com/adam-chen))
- Fixed the remove workspace dialog showing up behind the workspace menu on mobile ([#9103](https://github.com/getpaseo/paseo/pull/9103))
- Fixed the usage graph on web switching between a relative and an absolute Y-axis scale when switching the chart time range ([#9748](https://github.com/getpaseo/paseo/pull/9748))
- Fixed first-host suggestions listing unconnected hosts above recently used connected ones ([#8970](https://github.com/getpaseo/paseo/pull/8970) by [@linhua55](https://github.com/linhua55))
- Fixed Windows file watching constantly picking up `.git/index.lock` creation and removal when Git is writing the index ([#9072](https://github.com/getpaseo/paseo/pull/9072))
- Fixed slow desktop startup taking extra time in the About modal trying to fetch missing `GIT_COMMIT` Git SHAs ([#9154](https://github.com/getpaseo/paseo/pull/9154))
- Fixed plugin removal hanging forever when the configured plugin directory has disappeared ([#9231](https://github.com/getpaseo/paseo/pull/9231))
- Fixed tapping agent titles in the mobile agent list scrolling the row out of the visible area on smaller phones ([#8847](https://github.com/getpaseo/paseo/pull/8847) by [@adam-chen](https://github.com/adam-chen))
- Fixed provider model labels not using a fallback when a catalog `modelDisplayLabel` value is empty ([#9823](https://github.com/getpaseo/paseo/pull/9823))
- Fixed the Usage sidebar search field staying focused after selecting a provider and opening its usage card ([#9666](https://github.com/getpaseo/paseo/pull/9666))
- Fixed clicking a link in an agent turn not working when you previously clicked on the wrong turn ([#9707](https://github.com/getpaseo/paseo/pull/9707))
- Fixed Changes file counts excluding submodule roots ([#9745](https://github.com/getpaseo/paseo/pull/9745))
- Fixed a daemon crash when the file watcher encountered a broken `.git` symlink to a worktree directory that is gone ([#9233](https://github.com/getpaseo/paseo/pull/9233))
- Fixed file suggestions hiding after exactly 10 items, even when your filter or scroll offset still had more results ([#9606](https://github.com/getpaseo/paseo/pull/9606))
- Fixed Paseo making separate OpenHands clients for each workspace, causing a "Failed to create workspace" toast ([#9003](https://github.com/getpaseo/paseo/pull/9003))
- Fixed the action badge on native iOS staying invisible long after scrolling or expanding ([#9150](https://github.com/getpaseo/paseo/pull/9150))
- Fixed diffs opening to the wrong folder when you pressed Enter after deleting the search filter ([#9671](https://github.com/getpaseo/paseo/pull/9671))
- Fixed inline agent links not being tappable after the first link in the same line on iOS ([#9157](https://github.com/getpaseo/paseo/pull/9157))
- Fixed collapsing and expanding the Usage sidebar switching the order of visible provider cards ([#9624](https://github.com/getpaseo/paseo/pull/9624))
- Fixed OpenHands workspaces not archiving because the daemon tried to delete a running container ([#9012](https://github.com/getpaseo/paseo/pull/9012) by [@adam-chen](https://github.com/adam-chen))
- Fixed streaming the Claude model list failing with a null access token after Claude renews an expired user token ([#9855](https://github.com/getpaseo/paseo/pull/9855) by [@daysun-k](https://github.com/daysun-k))
- Fixed the file attachment modal showing no empty state when the directory tree is still loading ([#9720](https://github.com/getpaseo/paseo/pull/9720))
- Fixed worktree diff headers leaving out the working tree name during a worktree checkout ([#8946](https://github.com/getpaseo/paseo/pull/8946) by [@DTTerastar](https://github.com/DTTerastar))
- Fixed agent card tools showing "1 tools" instead of "1 tool" ([#9185](https://github.com/getpaseo/paseo/pull/9185) by [@DTTerastar](https://github.com/DTTerastar))
- Fixed browser test flakes when asynchronous navigation took longer than that test's timeout ([#9555](https://github.com/getpaseo/paseo/pull/9555))
- Fixed the mobile dock staying visible even when the keyboard comes up on Android ([#9074](https://github.com/getpaseo/paseo/pull/9074))
- Fixed Paseo web resetting the model menu and draft attachments when you navigate between workspace tabs ([#9556](https://github.com/getpaseo/paseo/pull/9556) by [@zeyugao](https://github.com/zeyugao))
- Fixed a crash when comparing the current commit to a branch whose name looks like a path but is not ([#9565](https://github.com/getpaseo/paseo/pull/9565))
- Fixed workspace settings lingering in the menu after archiving that workspace ([#9651](https://github.com/getpaseo/paseo/pull/9651))
- Fixed Pi responses getting cut off before finishing when Pi reached a token limit ([#9762](https://github.com/getpaseo/paseo/pull/9762))
- Fixed daemon CPU usage being high on Linux and Windows when there are many watched worktrees ([#9233](https://github.com/getpaseo/paseo/pull/9233))
- Fixed the desktop daemon not starting when `$SYSTEMD_EXEC_PID` is set on Linux ([#9232](https://github.com/getpaseo/paseo/pull/9232) by [@adam-chen](https://github.com/adam-chen))
- Fixed Pi and OMP streaming responses pausing when the final output delimiter is sent in pieces ([#9837](https://github.com/getpaseo/paseo/pull/9837))
- Fixed provider cards and settings not reflecting the chosen sort order on the first load ([#9665](https://github.com/getpaseo/paseo/pull/9665))
- Fixed Android release workflow retries leaving previous failed jobs in an "in progress" state ([#9799](https://github.com/getpaseo/paseo/pull/9799))
- Fixed the app crashing on web when you navigate to a nonexistent agent ([#9803](https://github.com/getpaseo/paseo/pull/9803) by [@ragokan](https://github.com/ragokan))
- Fixed a fresh workspace's agent list search box floating to the left on mobile instead of staying centered ([#9083](https://github.com/getpaseo/paseo/pull/9083) by [@zeyugao](https://github.com/zeyugao))
- Fixed workspace archive dropping uncommitted changes and unpushed commits without a warning ([#9625](https://github.com/getpaseo/paseo/pull/9625))
- Fixed Git worktree locks not expiring after a crash or forced shutdown ([#9763](https://github.com/getpaseo/paseo/pull/9763))
- Fixed `/permissions-edit` failing when the active host does not support editing permissions ([#9804](https://github.com/getpaseo/paseo/pull/9804))

### Security

- **Release signing change:** macOS desktop packages are now signed with the identity `Developer ID Application: Changsha Huanhui Yingchen Network Technology Co., Ltd` for fork releases. Upstream releases remain signed with their separate identity. Fork mobile releases also use separate identifiers.
