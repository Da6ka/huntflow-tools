#!/usr/bin/env bash
# Example: move applicant to Reject stage with a rejection reason.
# Look up IDs first:
#   node ../huntflow.js statuses        # find Reject stage ID
#   node ../huntflow.js rejections      # find rejection reason ID

APPLICANT_ID=500001
VACANCY_ID=100001
REJECT_STAGE_ID=200099
REJECTION_REASON_ID=300001   # "Mismatched qualification"

node ../huntflow.js move "$APPLICANT_ID" "$VACANCY_ID" "$REJECT_STAGE_ID" "$REJECTION_REASON_ID"
