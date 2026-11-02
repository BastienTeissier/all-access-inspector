# Map

The user asks for the access map: per Role and per Capability, whether the role passes, its Scope, and the Basis of each fact. `<map>` below is `node <skill>/map/src/cli.ts` (Node 24.2 or later), and `<project>` is the app root. The map joins four sources and decides nothing itself:

| Source | Where | Who writes it |
|---|---|---|
| Endpoint Inventory and Review Log | `tools/access-inspector/` | the Adapted Script, the reviewers |
| Map Runtime | `tools/access-map/runtime.json`, committed | the stack's Map Introspect, when the reference's "Map introspect" ships one |
| Map Vocabulary | `tools/access-map/vocabulary.json`, committed | you, with the user |
| page | `<skill>/map/page.html` | the toolkit; never copied into the project |

## Rules of the map

- Read before you write. A fact the code declares in a form a program can read (a dict, an enum, a config file, an annotation, a filter used the same way everywhere) is a Map Rule in the introspect's project section, with its `file:line`. The vocabulary holds only what no program can read, each entry with the `reason` it was not extracted. `map check` fails on a vocabulary entry a Map Rule already produces.
- Roles are the ones the code defines; the toolkit adds "not signed in".
- Whether a role passes a capability is computed. A route check's `who` says only what its cited line settles.
- You leave every cell undecided: `<map> decide` and the review app are the user's tools (SKILL.md § Hard rules, Human decisions).
- The project's `CONTEXT.md` belongs to the team: propose changes in the summary. A pinned anchor is fixed at its source, then pinned again.

## Steps

1. Check that `tools/access-inspector/inventory.json` is committed. If it is not, fit the project first (`workflows/fit.md`) and stop.
2. Read the stack reference's "Map introspect". When the stack has one (Django, NestJS), vendor it into `tools/access-map/` as it says, run it with the command it names, and exclude `tools/access-map/` from the linters as the reference's "Linters" says. When it has none, the runtime stays empty, every fact goes in the vocabulary, and you keep a list of the facts you saw in a readable form ("could be extracted").
3. Read the roles from the code, where the reference's "Map introspect" says they live: groups and their grants, the superuser bypass, what the sign-in assigns to every account, who passes staff checks, the relations a permission class tests (the record's creator, a seat holder, an API key). Give each a kind (`signed_in`, `superuser`, `group`, `relation`) from evidence; a `relation` role is let through by the Recognition Rules `RELATION_RULES` names, or by a `route_checks` entry with `who` `relations`. Write them as Map Rules (`roles()`, `includes()`, `staff()`, `grants()`), then the scopes and capabilities the code declares uniformly (`scopes()`, `scoped()`, `capabilities()`). Show the user each Map Rule with its evidence before saving it, as for a Recognition Rule. Run the introspect, then its `--check` (`--check` after `introspect.py` on Django, after `<inspect> map` on NestJS): it must exit 0.
4. Map each role and each area to the project's docs: `CONTEXT.md` when it exists, else the README or `docs/`, else the defining model or class, always as a `file:line` (`doc_at` on a role, `defined_at` on an area). Report every role the docs name and the code does not, and the reverse. When the project has no `CONTEXT.md`, propose starting one in the summary.
5. Write the vocabulary with the user, only for what no program read, each entry with its `reason`: capability names in the glossary's words (`extends` an extracted or derived capability), capabilities one action spans or outside any pattern (`endpoints`, `check`, `evidence`, `replaces`), scopes not read by a rule, checks inside handler bodies (`route_checks`, `roles` when `who` is `relations`), areas folding the third-party admin pages (`contains`), `domains` and `resources`, and the stack section the reference names. The shapes are in `<skill>/schema/vocabulary.schema.json`. When the stack section feeds the introspect, run the introspect again. Ask with AskUserQuestion when a name or a grouping is the team's call.
6. Run `<map> pin <project>`, which records the text of every `file:line` the vocabulary cites, then `<map> check <project>`. Exit 2 names an invalid file: fix it. Exit 1 lists the problems: fix each one except the partial capabilities, which the user decides. Leave those listed.
7. Run `<map> build <project>` and give the user the absolute path of `tools/access-map/out/access-map.html`. Propose ignoring `tools/access-map/out/`. Tell them the same map, with a decision form on each cell, is the review app's Access map (`node <skill>/review/src/cli.ts app <project>`).
8. Branch (fallback `access-map/fit`) and commit as in the fit's "Branch, commit, summary": stage `tools/access-map/` without `out/`, plus the linter exclusions. The body lists every Map Rule and every vocabulary entry with its reason.
9. Print the "Access map" part of `<skill>/assets/summary-template.md`: the coverage block `map check` prints (per area, first-party and third-party endpoints behind no capability, unnamed capabilities, areas with no term), each first-party gap with why it stays open, the partial capabilities left for the user to decide, the docs mismatches, and the "could be extracted" list.

Done when `map check` lists no unnamed capability in an unfolded area, every first-party gap is behind a capability or listed in the summary with why, and the only problems left are the partial capabilities for the user to decide.

## Look at the map

The user asks you to look at the access map. For each cell in scope (the partial and open ones, or the ones the user names), read the capability's `check` and its endpoints in `runtime.json` and `vocabulary.json`, then the code they cite: does the role reach what it should, and only that? Append one event per cell you read, in one call:

```bash
node <skill>/review/src/cli.ts append <project> --agent --model <your model id> <<'EOF2'
{"event":"signal_raised","capability":["export-orders","clerk"],"reason":"…","evidence":"shop/admin.py:24"}
{"event":"triaged","capability":["shop.order.view","manager"]}
EOF2
```

A Signal counts in the "Review queue: N signals" line of the Alerts tab until a later `triaged` closes it. It leaves the cell undecided.

Done when every cell in scope carries one event, all appended in one batch.
