# Goal attachment interaction

Status: implemented candidate with an independent browser verification handoff; see the [bounded verification record](acceptance/human-journey-review.md#goal-attachment-inputs) for coverage and remaining delivery work. Apply the [attachment PRD](goal-attachments-prd.md) and existing [human workbench UED](human-workbench-ued.md). This adds file input to existing goals and executable continuation notes, without another navigation destination. Shared rendered-source checks alone do not establish OS clipboard, input-method or narrow-screen behavior.

## Journey and entry placement

The design unit is the existing request and its selected material. Keep project navigation, global filtering, saved-pipeline selection and the result/history regions in their current locations. Adding a file never opens a second task form. A ready-file label describes stored input; a work receipt describes an acknowledged submission; the observed execution describes what the runtime is doing.

| Entry | Reading and action order | Context that remains visible |
| --- | --- | --- |
| G1 project Workbench | Outcome field → selected files → keyboard/size hint and Attach files → existing account/start actions. | Current project and the ordinary workbench sections. |
| G2 global Workbench | Existing target selector → the same field/file/action treatment as G1. | The target project; global project filter and navigation remain independent. With no target, show Choose a project and no active file control. |
| G3 completed result | Result → Continue here field and files → its send action → existing follow-up/context links → Activity. | Current result and predecessor links. Do not autofocus the composer or copy historical cards into the unsent selection. Apply in both shells. |
| G4 clarification | Actual question → Reply field and files → Send reply. | The question and existing goal. Retain the existing absence of a duplicate Continue action when inline reply is ready. Apply in both shells. |
| G5 saved pipeline | Dialog title → Task field → selected files and add control → existing execution path/details. Keep Cancel/Start in the separate footer. | Project and selected pipeline; Workbench shortcut and library Run open this same dialog and draft. |
| G6 ordinary goal recovery | Existing reason/affected step → optional Note field and files → its existing retry/decline group. | Current recovery target and earlier evidence. The header recovery shortcut must reach this same draft. Apply in both shells. |
| G7 advanced goal continuation | Existing continuation/account context → answer or optional Note field and files → existing advanced settings. Keep Close/Continue in the same separate, reachable footer pattern as G5. | Same goal and confirmed recovery basis; the clarification branch keeps its actual question. Closing and reopening preserves input. |
| G8 stage recovery | Existing reason → the single existing retry/decline group → optional Note field, add control and selected files → recovery details. | Run, step and attempt. Preserve the quick action above the optional note; do not add another Start button below the files. Apply in standalone and goal-owned views in both shells. |

The ordinary composer list sits between its textarea and footer. Recovery inputs can keep their existing action placement; reuse the file control, rows, status and submission guard instead of forcing every surrounding section into a new layout. When G8 has selected files, put their count and any submission blocker beside the existing primary action as well as beside the affected row. The summary links to that file list; it is not another submit control. At narrow widths let the actions and summary wrap in document flow.

| Journey point | Expected interaction |
| --- | --- |
| Choose and describe | Retain the actual project/pipeline/question; type normally. File limits are subordinate help, not a setup step. |
| Add and recognize | Button, file paste and file drop append to the same ordered selection. Show preparing/uploading, then the verified thumbnail, escaped excerpt or file card. Stay at the current focus/reading position. |
| Correct or recover | Remove one mistaken file, retry/reselect an interrupted one, or change text. Keep successful siblings. Restore a draft in its scope without claiming an unfinished transfer completed. |
| Submit and observe | Existing action sends one text/manifest snapshot when eligible. Upload failures explain the disabled work action; an acknowledged work receipt survives a failed observation. |
| Inspect or continue | Read submitted files with that request/attempt. Follow-up/clarification/retry adds deliberately selected material and keeps original history. Return through the same shell and project selection. |

## Placement and adding files

Use one shared attachment treatment for G1–G8 in the PRD inventory. Keep the text field, its keyboard hint and its existing submit action in their current spatial roles. In ordinary composers add a compact Attach files button next to the composer actions, and place the selected-file list directly beneath the text field. In recovery, keep the add control beside the instruction field and retain the action order specified above. The saved-pipeline and advanced-continuation dialogs use the same list in their scrolling bodies with reachable action footers. Follow-up and clarification attachments stay beside their actual request/question, before Activity.

The button opens the native multiple-file picker. Cancelling it changes nothing. Give it an accessible name in the active locale; an icon alone is insufficient. Keep the selected project visible, particularly in the global composer. When no project is selected, provide no upload destination and accept no files.

Pasting files while focus is within the request's text field uses that field's project and draft scope. Preserve plain text at the caret for text-only and mixed paste. Do not intercept clipboard actions elsewhere in the application. If the browser supplies no file item, keep ordinary paste working and point to Attach files when a file-paste limitation can be identified. Pasting an image URL or HTML never starts a download.

Dragging actual files over an eligible composer highlights only that input boundary and shows Drop files here. Dropping adds to that draft without submitting. Remove the highlight after drop, drag leave or cancellation; nested controls must not flicker between active/inactive treatment. Do not add a whole-page drop overlay or require dragging on touch/narrow devices. Reject directory items with a local explanation. Text/link drops retain ordinary editing behavior.

Adding files does not move focus, submit text, approve account access or start execution. Register every file in a selected batch immediately, before preparing the first file, so the list and work-action guard represent the complete selection throughout delayed uploads. Removing a pending row or clearing the acknowledged draft invalidates its unfinished work; later preparation, receipt lookup or upload completion cannot recreate rows. Keep button upload available when clipboard/drop is unavailable. Existing source/account readiness may block execution while the person prepares a private draft; those gates do not claim that uploaded material is already available to a runtime.

## File rows and previews

Each selected file has one compact row/card with preview, wrapping display name, readable size, status and Remove. Preserve order. Use a small thumbnail (approximately 56–64 CSS pixels) beside wrapping metadata on desktop; allow metadata and actions to stack at narrow widths. Text excerpts start with a compact reading area and can disclose the remaining bounded excerpt without expanding every file by default. Show a quiet local preview while preparing if available, but mark it as uploading until the durable receipt arrives. Only ready files are represented as saved inputs.

| State | Presentation and useful action |
| --- | --- |
| Preparing / uploading | Filename, explicit status and genuine byte progress only when known. Remove is available. Never invent a percentage or model-running state. |
| Ready image | Bounded static thumbnail plus filename and size. Use a descriptive accessible label. No animation is required. |
| Ready UTF-8 text | Literal excerpt inside a bounded reading area; long content wraps or scrolls within it. Mark an excerpt as truncated. Empty content says Empty file. |
| Ready document/binary | File icon, name, type when detected, size and ready label. Explain Preview unavailable when useful; the file remains attached. |
| Preview failed / too large to decode | Keep the uploaded file as a ready card, with a concise preview limitation. Do not label successful storage as a failed upload. |
| Upload failed / interrupted / original missing | Identify that file and reason; offer Retry when bytes remain available, otherwise Choose file again, and Remove. Block work submission until resolved or removed. Preserve other files and text. |
| Aggregate selection too large | Keep the draft visible, name the 32 MiB total boundary, and let the person remove files. Do not discard a random subset or submit one silently. |

Images use at most a small thumbnail within the card; no full-screen viewer is needed. Text is escaped rather than rendered as supplied HTML/Markdown. PDFs, office documents, archives and other binaries need only the information card specified in the PRD. An optional explicit open/download action must use authenticated project access, follow the content-safety contract and never turn an unverified file into inline application content.

Remove has an accessible name including the file's display name. It affects the unsent selection only and needs no confirmation. Restore focus to the next file's action, the previous file's action, or Attach files when the list becomes empty. Revoke obsolete local preview resources when removing/replacing items or leaving a view. A late completion cannot recreate a removed card. Equal filenames with different contents show size/preview detail to select the intended item. If name and size also collide, give the distinct items stable localized qualifiers such as File 1 / 文件 1 and File 2 / 文件 2, in selection order; include that qualifier in action names and do not renumber surviving items after removal. Identity/digest remains available in Details; filename and size alone do not identify an attachment.

## Draft and submission feedback

Use one short accessible hint near the add control for 10 MiB per file and 32 MiB total. Retain the existing quiet draft treatment; do not add another standing paragraph about storage or orchestration. Restored ready files keep their preview or a truthful file card. Restored incomplete transfers say Upload interrupted and ask for retry/reselection; do not present an endless loading indicator. A storage failure explains what can currently be retained.

Starting work still requires the existing concrete text where applicable. An attachment alone does not enable an otherwise empty Start/Reply. Optional recovery notes remain optional. Files prepared beside a paused-run Resume remain a draft because that operation does not consume instructions; show a concise hint and no sent-file claim. Where only decline/stop is available, do not offer a misleading attachment submission action. Failed uploads never block Stop or decline.

While any selected upload is incomplete or failed, keep the ordinary work action disabled and give an accessible reason linked to the file list. A retry reuses ready siblings. Once ready, pressing the existing action snapshots text and files together. During submission use the ordinary busy state and prevent repeated sends; separate Uploading file from Starting work. Preserve cancellation behavior: removing/cancelling an upload does not cancel a goal, and dismissing a view does not cancel server work.

| Selected material / operation | Add, retry and remove | Primary work action | Other controls |
| --- | --- | --- | --- |
| No files, or all selected files ready | Available during draft preparation. | Follow existing text, source, account and recovery guards. Files never make required text optional. | Existing navigation and owner decisions. |
| Preparing, uploading, failed, interrupted, missing or over aggregate boundary | Keep correction available; show the affected file/reason. | Disabled for instruction-consuming work through every entry and keyboard shortcut. | Stop, decline and closing an idle view remain available. |
| Preview failed; original ready | Remove remains available; the card names the preview limitation. | Eligible under ordinary guards. | No forced re-upload or conversion. |
| Uploads ready but source/account/recovery boundary blocks work | Keep private draft preparation available. | Keep the real boundary and its existing action visible; uploading does not approve it. | Existing account/recovery actions retain their authority. |
| Work write pending or unconfirmed | Freeze its submitted snapshot; a newer draft remains separate. | Busy/uncertain-receipt recovery uses the original submission identity. | Preserve supported authoritative cancellation; closing does not cancel work. |
| Plain paused-run Resume or a separate read-only execution observation | Retain the draft, including a failed file. | The non-consuming operation may proceed under its own guards; it sends no files. | Show the draft-only hint for Resume. Do not clear it or claim attachment delivery. |

A known receipt opens or preserves its actual goal/run and submitted file list even if the following observation fails. Show the existing refresh warning/action for that read failure. An unconfirmed write retains its text, files and retry identity; retrying is not a fresh start. A late response cannot clear newer work, insert files into another project or change the current selection. Scope changes restore their own draft; they never transfer files by visual proximity.

## Recovery shortcuts and draft scope

The goal header currently has a direct recovery shortcut, separate from the optional instruction field. With a prepared instruction or selected files, that shortcut must focus the owning composer or invoke its exact guarded snapshot; it cannot call an empty-note start and omit the visible material. Keep one primary submission path. A failed selected file blocks consuming shortcuts and Enter equally, without disabling Stop/decline.

For the same confirmed goal recovery target/basis, switching from ordinary recovery to advanced continuation and back retains the instruction text and selected files. Model/configuration fields keep their existing deliberate advanced meaning. Opening advanced controls does not upload again, refresh the execution basis, copy historical input or dispatch. A different target, question, attempt or recovery generation retains the older draft in its original scope; explain Changed context when it needs review. Do not silently transfer or evict it. G1/G2 share their existing same-project outcome draft; saved pipelines, parent results and questions retain the scopes listed in the PRD.

After an upload error, Retry upload concerns bytes; Retry this step concerns execution. Keep those labels distinct. After a successful upload and failed work observation, offer observation refresh beside the retained work receipt. After a stale continuation rejection, retain input and offer the existing current-state review rather than starting a new goal. A combined check-and-retry action can consume instructions, so selected-file guards apply before calling it. If a resolution returns a check/needs-input result without accepting the instruction, retain files and text; only the consuming receipt clears its exact version.

## Submitted material and continued work

Show submitted file rows beside the full request in the existing collapsed disclosure, separate from produced artifacts. The compact heading/list preview continues to derive from the user's text. Read-only attachment rows retain filename, size and preview availability; ordinary views need not display hashes or storage paths. Existing execution/context details expose pinned identity and digest for inspection. No draft Remove action appears on historical input.

Continuation history shows the instruction/question and files supplied on that attempt, distinct from the original request's files. An acknowledged retry does not rewrite earlier rows. Follow-ups keep preceding-result navigation and identify inherited material through the existing context disclosure, without stacking all prior previews into the new composer or silently treating historical text as current instructions. Make unavailable/omitted material explicit.

A runtime access failure names the affected file and existing permission/capability boundary, with an actionable recovery route. Do not describe Uploaded or a visible thumbnail as proof that a model read the contents. Keep actual execution state and product outcome labels independent of upload/preview state.

## Keyboard, locale and narrow layout

Keep the existing composition-safe Enter, Shift+Enter, Command/Ctrl+Enter and held-key guards in request textareas. Apply shared handling to continuation instruction fields; preview text and file buttons keep native keys. Tab reaches Attach files, each file action, recovery actions and submit in document order, with visible focus. Announce batch addition, readiness and actionable failures through a polite status region; avoid repeated announcements for every progress byte. Errors are associated with their file and use text/icons as well as color.

All hints, states, accessible names and errors have equivalent English/Simplified Chinese copy separate from execution codes. Preserve the uploaded filename in its original language; escape it and wrap long/unbroken names. Localized action examples are Attach files / 添加附件, Remove / 移除, Retry upload / 重试上传, Choose file again / 重新选择文件 and Drop files here / 将文件拖到这里. Uploading / 上传中 and Preview unavailable / 无法预览 remain distinct from execution status.

Use the following paired copy as the implementation contract. Runtime state codes stay separate from these strings; localize known error categories and keep raw technical diagnostics in Details. Substitute display names as text, never HTML.

| Meaning | English | Simplified Chinese |
| --- | --- | --- |
| Add control | Attach files | 添加附件 |
| Resource hint | Up to 10 MiB per file · 32 MiB total | 每个文件不超过 10 MiB · 合计不超过 32 MiB |
| Drop target | Drop files here | 将文件拖到这里 |
| Preparation | Preparing… | 准备中… |
| Upload state | Uploading… | 上传中… |
| Durable original | Ready | 已就绪 |
| Upload failure | Upload failed | 上传失败 |
| Interrupted transfer | Upload interrupted | 上传已中断 |
| Byte retry | Retry upload | 重试上传 |
| Reselection | Choose file again | 重新选择文件 |
| Removal action/name | Remove / Remove {name} | 移除 / 移除 {name} |
| Empty text | Empty file | 空文件 |
| Excerpt boundary | Preview truncated | 预览已截断 |
| Card fallback | Preview unavailable · File attached | 无法预览 · 文件已添加 |
| Blocking selection | Resolve or remove the affected files before starting. | 请先处理或移除有问题的文件，再开始执行。 |
| Oversize original | This file exceeds 10 MiB. Choose a smaller file or remove it. | 此文件超过 10 MiB。请重新选择较小的文件，或移除此项。 |
| Oversize selection | Selected files exceed 32 MiB. Remove files to continue. | 所选文件合计超过 32 MiB。请移除部分文件后继续。 |
| No upload destination | Choose a project to attach files. | 请先选择项目，再添加附件。 |
| No directory import | Folders are not supported. Choose individual files. | 暂不支持文件夹，请选择单个文件。 |
| Non-consuming resume | These files remain in your draft. Resume does not send them. | 这些文件仍保留在草稿中；恢复执行不会发送它们。 |
| Browser storage failure | Draft recovery after reload is unavailable. Keep this page open or reselect files later. | 刷新后暂时无法恢复草稿。请保留当前页面，或稍后重新选择文件。 |
| Changed target/basis | The continuation context changed. Review the current work before reusing this draft. | 继续执行的上下文已变化。请先检查当前任务，再复用这份草稿。 |
| Submitted input disclosure | Attached files ({count}) | 附件（{count}） |

At desktop, 700px and the 320px minimum, cards wrap in normal document flow and controls remain reachable without horizontal page scrolling. Avoid a fixed-height grid that hides failed items or pushes modal submit controls out of reach. Keep full-size text controls, readable file names, focus visibility, text zoom and reduced-motion support from the shared UED.

## Required rendered review

For every G1–G8 input and its listed shell/branch, operate button upload, browser-exposed file paste and file drop, then preview, removal and submission. Include an image, text, a binary card, long/Chinese filenames, a partial failure, removal during upload, reload, late receipt and project switch. Check keyboard/composition, both locales, desktop/narrow layouts and dialog focus restoration. Record unsupported OS clipboard/input-method branches explicitly. Shared source tests and screenshots do not establish those browser operations or a real provider read; QA records them separately using the PRD acceptance examples.

Include the header-to-composer recovery shortcut, ordinary/advanced handoff, both saved-pipeline launch origins, identical name/size with different content, and paused Resume with failed selected files. A passing path must retain or submit the intended material through the actual entry, without a second primary action or a text-only bypass. Keep these as focused regression cases for the implementation/QA stages; this design specification does not mark them passed.

## Retained browser continuation

Opening the explicit current-browser choice retains the ordinary recovery instruction and selected files in their exact project/run/stage/attempt scope. Closing and reopening the dialog keeps that draft. A pending or failed upload blocks continuation; it does not block Stop or Cancel. The browser checkbox remains unchecked by default and is invalidated by a changed target or configuration. A returned-finding action consumes its review note and retained QA evidence only; explain and disable it while the continuation has unsent files.

The selected-files control focuses and scrolls to its local attachment group. It must not replace the application hash route or leave the current project, goal or execution. Keyboard activation uses the same local focus action.
