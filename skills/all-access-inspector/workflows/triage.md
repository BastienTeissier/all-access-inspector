# Triage

The user asks you to triage the inventory. The deterministic tiers see only the inventory's facts; you read the handlers and point at what they cannot see. Your output only reorders the Review Queue: it never clears an endpoint.

`<review>` below is `node <skill>/review/src/cli.ts` (Node 24.2 or later), and `<project>` is the app root.

1. Check that `tools/access-inspector/inventory.json` is committed (`git ls-files`). If it is not, tell the user to fit the project first and stop.
2. Run `<review> status <project> --json`. Each line is one queued row.
3. Pick the scope: rows with `triage` true. The CLI leaves out:
   - rows a human gave a valid Verdict;
   - rows an authorization rule decides alone, since judging a rule is the reviewer's work;
   - rows whose agent event still holds for their current classification.

   If the user named endpoints or a path prefix, keep only those.
4. For each row in scope, open its `handler` (`file:line`) and read it with the stack reference's "Triage checklist". A handler that is a dotted name with no project file is third-party: read the project line that mounts it, or skip the row and say why.
5. Decide one event per row:
   - `signal_raised`, when something in the handler needs a human: a one-line `reason` (at most 500 characters) and the `evidence` you read, as `relative/path:line`;
   - `triaged`, when you found nothing.
6. Append all of them in one call, so they share one batch:
   ```bash
   <review> append <project> --agent --model <your model id> <<'EOF'
   {"event":"signal_raised","method":"POST","path":"/api/orders/{pk}/refund/","reason":"…","evidence":"shop/api.py:24"}
   {"event":"triaged","method":"GET","path":"/catalog/status"}
   EOF
   ```
   Add `"handler"` to a line when the method and path have several handlers. A refusal (exit 2) writes nothing: fix the line it names and run the call again.
7. Print a summary: the endpoints you read, the files that changed (`reviews.jsonl`, and `.gitattributes` when the CLI created it), every Signal you raised with its reason, and every row you skipped with why. Tell the user to run `<review> status <project>`: a Signal lifts its row to tier 7, "suggested by the agent", unless the row already sits in a higher tier, where it shows beside the other Signals.

Triage changes only `reviews.jsonl`, plus `tools/access-inspector/.gitattributes` on the first run in a project (the CLI adds its `merge=union` line). The inventory and the Adapted Script stay as they are, and the user commits both files.

Done when every row in scope carries one event, all appended in one batch, and every skipped row is named with why.
