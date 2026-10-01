#!/usr/bin/env bash
# Example: add a candidate from a CV file to a specific vacancy.

python3 ../add_applicant.py \
  --cv ./cv_example.pdf \
  --vacancy-id 100001 \
  --status-id 200001 \
  --money "2400 EUR/mo" \
  --comment "Cold inbound. Self-rated English B2, UTC+5, open to contract."
