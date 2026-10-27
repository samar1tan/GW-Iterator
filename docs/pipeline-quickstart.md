# Pipeline quickstart

Use a small documentation correction as your first journey through GWI.
Complete [local setup](multica-setup.md), then open `http://127.0.0.1:4318`.
The [operating guide](operating-guide.md) explains controls and recovery in detail.

1. **Choose the project.** From Projects, select the workspace that owns the
   document. Each project has its own team, pipelines and knowledge. If it is
   new, connect its local location and review the adoption proposal before
   applying it; applying configuration does not start work.
2. **State the outcome.** In Workbench, describe the correction, its scope and
   the evidence you expect: for example, “Correct the outdated setup instruction
   in one document; verify the replacement against current source and check
   its links.” For a known bounded change, run the saved **Focused change**
   pipeline from Pipelines, then enter the concrete correction in its launch
   dialog. The workflow supplies the role, model and finite allowance defaults.
3. **Follow stages and owners.** Open the action's steps and select a
   stage to inspect responsibility, inputs, checks, actual results and controls.
   The default Focused change path is **Prepare the bounded change**
   (Development), **Independently verify the change** (QA), then the manual
   **Owner delivery acceptance** stage. Project definitions can differ; follow
   the actual run rather than assuming these defaults are its live state.
4. **Inspect the work.** Use **Inspect changes** to read the execution checkout's
   tracked diff and status, and preview the actual relative text artifact.
   Confirm that the intended document changed and that unrelated files did not.
   Runs use committed-source checkouts and record their input commit; changes
   in the original dirty workspace are not their source baseline.
5. **Use independent QA and focused rework.** QA should read the actual changed
   document, verify its claims against source, and check links and scope. Attach
   a concrete defect when returning work for revision. Bounded rework returns
   findings to the responsible upstream stage, invalidates affected downstream
   work and retains earlier attempts and independent accepted work.
6. **Accept delivery from evidence.** At the manual delivery stage, inspect the
   artifact and independent checks. If integration or publication is required,
   require the actual integrated commit or PR and relevant CI result, tied to
   that revision. Record pending or unperformed work explicitly. A successful
   agent task or completed preparation stage is not acceptance of the outcome.

Unchanged human or CI waits spend no model turns: retain the recorded state
until new evidence or a decision arrives. Do not repeatedly prompt an agent
to ask whether anything has changed. Use the recorded review or manual-stage
result when it is ready; use Pause, Resume or Stop to control further work.

Isolated changes are **not published automatically**. A configured delivery
role or the supervising owner must integrate or publish the accepted result
and retain real evidence. Previewing an artifact does not perform delivery.
