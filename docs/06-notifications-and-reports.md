# 06 — Notifications & reports

## The rule engine

Notifications are configuration, not code. A rule is:

```
WHEN   event_code            e.g. STAGE_BLOCKED
AND    condition (jsonb)     e.g. blocked_minutes > 60
THEN   notify recipients     roles[] and/or an expression
                             (order.sales_rep, order.customer, station.supervisor)
VIA    channels[]            PUSH | WHATSAPP | SMS | EMAIL | IN_APP
USING  template_key          rendered in the recipient's locale
RESPECTING quiet_hours, throttle_minutes
```

Rules are editable by the owner in the admin UI. Three properties keep the system
from becoming noise:

- **Throttling.** `throttle_minutes` collapses repeats of the same rule for the
  same subject — one "material short" alert per material per day, not per work
  order.
- **Digest mode.** A rule can be marked digest-only; it accumulates and is
  delivered in the daily summary instead of interrupting.
- **Quiet hours.** Per user. Anything raised during quiet hours queues to the
  next window unless the rule is marked critical.

**Channel guidance:** staff get PUSH (free, instant) with WhatsApp fallback only
for critical items; customers get WhatsApp — it is the channel Egyptian customers
actually read — with SMS as fallback and email for documents.

## Notification matrix

### Owner
| Trigger | Channel | Notes |
| --- | --- | --- |
| Daily operations summary, 20:00 | Push + WhatsApp | The one message read every day |
| Weekly business summary, Saturday 09:00 | Email (PDF) | |
| Monthly pack, 1st of month | Email (PDF + Excel) | |
| New order above threshold value | Push | |
| Order flagged `ORDER_AT_RISK` | Push | With the specific cause |
| Order became `ORDER_LATE` | Push | Escalation |
| Station blocked > 60 min | Push | |
| Whole line stopped > 30 min | Push, critical | Ignores quiet hours |
| Approval required (discount, PO, promise change, scrap, refund) | Push | Deep-links to the approvals inbox |
| QC fail rate above threshold for a station, per day | Push | |
| Material below reorder point | Digest | |
| Photo coverage below threshold at a station | Digest | Weekly, per station |
| Payment received above threshold | Push | |
| Delivery failed | Push | |
| Override used | Digest | |
| Customer complaint opened | Push | |

### Showroom (manager + the owning sales rep)
Order accepted or rejected by the factory · promise date changed (with reason) ·
customer approval needed · design approved by customer · production started ·
QC passed / ready for delivery · delivery scheduled and completed · balance
outstanding after delivery · quotation about to expire · transfer request
approved and dispatched.

### Factory (manager, supervisor, worker)
New order accepted into the queue · work order assigned to my station · material
shortage blocking a scheduled job · rework raised against my station · rush order
inserted (with what moved) · QC failure · purchase order received · stage blocked
beyond threshold · tomorrow's plan published, 17:00.

### Customer (WhatsApp)
Order confirmed with the tracking link · deposit received · design ready to
approve · design approved, production scheduled for DATE · production started ·
preview photos ready to approve · quality check passed · ready — pick your
delivery slot · out for delivery today with driver name and window · delivered,
here is your invoice and warranty · balance reminder · feedback request (24h
after) · warranty expiring in 30 days.

Every customer message respects a per-order opt-out and a global daily cap so the
factory never spams a customer into blocking the number.

---

## The owner's report pack

Each report answers a specific question, has a period filter and a comparison to
the previous period, and exports to PDF and Excel.

### Daily (in the 20:00 summary)
1. **Orders in** — count, value, standard vs custom, per showroom, per rep.
2. **Output** — units finished per station, vs. plan.
3. **Deliveries** — completed, failed with reasons, scheduled tomorrow.
4. **Cash** — deposits and balances collected, by method.
5. **Exceptions** — new at-risk orders, blockers still open, QC failures.

### Weekly
6. **On-time delivery %** — delivered on or before promise, trend, and the list
   of misses with their cause.
7. **Bottleneck analysis** — average and P90 time per stage vs. standard, queue
   length per station, and where WIP is piling up. The single most valuable
   report for increasing capacity without buying machines.
8. **Blocked-time analysis** — minutes lost by reason code, by station. Turns
   "the factory is slow" into "we lost 41 hours to `NO_MATERIAL` at upholstery".
9. **Quality** — defect rate by station, by product, by defect code; rework cost
   by attribution.
10. **Sales funnel** — quotations sent → approved → confirmed, conversion rate
    and average days to convert, per rep and per showroom.
11. **Custom-order health** — average revisions before approval, average days
    stuck awaiting customer approval, by designer and by rep.

### Monthly
12. **Cost & margin per order** — planned vs. actual material, labour minutes
    costed, overhead allocation, gross margin. Sorted worst-first, because the
    loss-making orders are the ones you need to understand.
13. **Material consumption** — BOM planned vs. actually issued, waste percentage
    by material and by station. Finds both theft and genuine scrap.
14. **Product profitability** — margin and volume per product and per category;
    which products to promote, reprice, or retire.
15. **Inventory health** — stock value by location, slow-moving finished goods
    (aged over N days), materials below reorder, stock-count variances.
16. **Capacity utilisation** — booked vs. available minutes per station; the
    evidence for hiring or buying equipment.
17. **Delivery & installation** — average days from confirmation to delivery,
    split by standard and custom; failed-delivery cost.
18. **After-sales** — tickets by type, SLA compliance, warranty cost per product,
    complaint root causes.
19. **Sales-rep scorecard** — value sold, margin sold (not just revenue),
    conversion, discount given, spec errors attributed, customer rating.
20. **Overrides & approvals** — every threshold override with who, why, and what
    it cost.

### Photo coverage
23. **Photo coverage** — percentage of required photos actually captured, by
    station and by worker, and the list of optional gates being skipped. A
    station at 100 % is genuinely documenting; a station at 60 % has found a way
    around the gate, which is worth knowing before a dispute rather than during
    one.

### Live (not periodic)
21. **Order pipeline value** by stage — how much money is sitting in each stage.
22. **Cash position** — deposits held against undelivered orders, outstanding
    balances aged 0–30 / 31–60 / 60+.

## At-risk detection

The rule behind `ORDER_AT_RISK`, evaluated hourly:

```
projected_finish = now
                 + remaining_standard_minutes / station_throughput
                 + queue_wait_at_each_remaining_station
                 + material_lead_time_if_not_reserved
                 + pending_customer_approval_days

at_risk  when  projected_finish > promised_date - buffer_days
late     when  now > promised_date and status != DELIVERED
```

The alert always carries the *dominant* cause, so the owner is told
"waiting on the customer's design approval for 6 days", not "order 412 is at
risk". An alert without a cause is an alert people learn to ignore.
