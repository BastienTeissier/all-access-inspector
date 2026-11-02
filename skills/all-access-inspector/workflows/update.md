# Update

A project already has `tools/access-inspector/`. Keep what the team decided and work only on what changed. `<inspect>` and the file names are the stack reference's "Vendor and run"; the steps named below are those of `workflows/fit.md`.

1. Read the project sections of the boot, rules and dimensions files. Each of these entries survives byte for byte unless step 2 or 4 changes it. If the inventory's `stack` differs from `base_script.stack`, the Adapted Script was improvised: follow `<skill>/references/unsupported.md` § Update mode, which offers a re-base once a Base Script exists for the stack.
2. Check each Recognition Rule's evidence. If the file and line still show the construct, keep the rule. If the construct moved, grep for it and update the evidence. If it is gone, remove the rule and give the reason in the summary.
3. Run `<inspect> --check`.
   - Exit 2 from a boot error: fix the boot file under the same toward-production rule, without touching rules.
   - Exit 2 from a missing dimension: extend the dimensions file, asking for any new value.
4. Run `--unknowns` and resolve only the new ones, as in the fit's "Resolve every unknown".
5. Refresh the Base Script only when the user asks. Replace each vendored file with the current Base Script file, keeping the project's project section, and update `VERSION`. When the new Base Script's project section declares something the kept one lacks (e.g. a new `ENVIRON` list, or `EXPECTED`), add that declaration with the Base Script's empty default, then offer to fill `EXPECTED` as in the fit's "Propose Project Dimensions". Then regenerate `inventory.json` before running `--check`: an inventory written by an older Base Script may not load. The inventory diff shows any endpoint whose classification the toolkit change moved; list those endpoints in the summary.
6. Leave `reviews.jsonl` and `tools/access-inspector/.gitattributes` as they are: they are not vendored files, and a refresh neither replaces nor deletes them. A regenerated inventory makes the affected Verdicts outdated on its own, through replay.
7. Regenerate `inventory.json` and run `--check`. If neither `tools/access-inspector/` nor `inventory.json` changed, say "no change" and stop with nothing committed. Otherwise do the fit's "Branch, commit, summary", with a summary limited to what changed.

Done when every rule whose evidence vanished is named in the summary, every new unknown is resolved or acknowledged, and `--check` exits 0.
