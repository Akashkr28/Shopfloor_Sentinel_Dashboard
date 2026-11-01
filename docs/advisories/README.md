# ICS advisories

Put real ICS advisories here, and Sentinel's AI triage will cite them next to the playbooks. Two formats are indexed:

- **CISA ICS advisories (CSAF 2.0 JSON).** Fetch the advisories that match your vendors directly from CISA's official repository (github.com/cisagov/CSAF):

  ```bash
  node backend/scripts/fetch-cisa-advisories.js --match "Siemens|Schneider|Rockwell|Mitsubishi" --limit 40
  ```

  Then re-index with **Setup → AI & playbooks → Re-index**, or `npm --prefix backend run kb:index`.
- **Any text or Markdown file** (a vendor security bulletin, an internal note), with optional front matter:

  ```
  ---
  title: Vendor X HMI security bulletin 2026-03
  kind: ADVISORY
  url: https://vendor.example/psirt/2026-03
  ---
  ```

Only add advisories from their official source, so the agent never cites anything made up.
