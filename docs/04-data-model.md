# 04 — Data model

PostgreSQL. `id` is UUID everywhere. Every table carries
`created_at, updated_at, created_by`. Money is `numeric(14,2)` + a currency
column, never floats. All user-facing names are `name_ar` / `name_en`.

## Identity & organisation

```
roles(id, key, name, permissions jsonb, approval_limits jsonb)
users(id, name, phone, email, password_hash, role_id, locale, is_active, last_seen_at)
locations(id, type[FACTORY|SHOWROOM|WAREHOUSE], name, address, geo point, phone)
user_locations(user_id, location_id, is_primary)
stations(id, location_id, code, name, type, daily_capacity_minutes, is_active)
```

## Catalogue & configurator

```
product_categories(id, name_ar, name_en, parent_id, default_routing_id)
products(id, sku, name_ar, name_en, category_id, kind[STANDARD|CUSTOMIZABLE],
         base_price, currency, base_lead_days, warranty_months, is_active)
product_media(id, product_id, url, kind[PHOTO|DRAWING|360|VIDEO], sort)

option_groups(id, key, name_ar, name_en,
              kind[FABRIC|WOOD|FINISH|COLOR|DIMENSION|HARDWARE|ADDON],
              selection[SINGLE|MULTI|NUMERIC])
options(id, option_group_id, code, name_ar, name_en, swatch_url,
        price_delta, price_mode[FIXED|PERCENT|PER_M|PER_M2],
        lead_days_delta, linked_material_id, is_active)
product_option_groups(product_id, option_group_id, is_required, min_sel, max_sel, sort)

product_variants(id, product_id, option_signature, sku, price, lead_days, is_sellable)
```

`options.linked_material_id` is what connects the showroom swatch to the
warehouse: choosing fabric `F-214` reserves metres of material `F-214`.

## Materials, BOM, inventory

```
materials(id, code, name_ar, name_en, unit[PCS|M|M2|M3|KG|L], category,
          reorder_point, reorder_qty, avg_cost, lead_days, preferred_supplier_id)
bom_lines(id, product_id, variant_id, material_id, qty_per_unit, scrap_pct, stage_key)
bom_option_lines(id, option_id, material_id, qty_per_unit, replaces_material_id)

suppliers(id, name, phone, email, terms, rating)
purchase_orders(id, code, supplier_id, status, expected_at, total, created_by, approved_by)
purchase_order_lines(id, po_id, material_id, qty, unit_cost, qty_received)

stock_items(id, ref_type[MATERIAL|PRODUCT], ref_id, location_id,
            qty_on_hand, qty_reserved, bin)          -- unique(ref_type, ref_id, location_id)
stock_moves(id, ref_type, ref_id, qty, from_location_id, to_location_id,
            reason[PURCHASE|ISSUE|RETURN|PRODUCE|TRANSFER|SALE|ADJUST|SCRAP],
            doc_type, doc_id, user_id, occurred_at)
stock_counts(id, location_id, status, started_by, closed_at)
stock_count_lines(id, count_id, ref_type, ref_id, qty_system, qty_counted, variance)
```

`qty_available = qty_on_hand - qty_reserved`. Reservation happens at order
confirmation, consumption at material issue.

## Customers & sales

```
customers(id, name, phone, whatsapp, email, addresses jsonb, source, notes,
          tags[], created_by)
orders(id, code, kind[STANDARD|CUSTOM|MIXED], channel[SHOWROOM|FACTORY|ONLINE],
       customer_id, showroom_id, sales_rep_id, status, priority,
       subtotal, discount, tax, total, paid_total, currency,
       promised_date, tracking_token, cancelled_reason)
order_lines(id, order_id, product_id, variant_id, qty, unit_price, line_total,
            line_kind[STANDARD|CUSTOM], status, promised_date, routing_id)
order_line_options(id, order_line_id, option_id, value_text, value_number, price_delta)

quotations(id, order_id, version, status, valid_until, total, pdf_url, sent_at)
custom_specs(id, order_line_id, revision_no, measurements jsonb, notes,
             drawing_urls[], reference_urls[], designer_id,
             approval_status, approved_at, signature_url, approved_channel)
payments(id, order_id, kind[DEPOSIT|INSTALMENT|FINAL|REFUND], amount, method,
         reference, received_by, received_at)
invoices(id, order_id, number, issued_at, total, status, pdf_url)
```

## Production

```
routings(id, name, category_id, is_default)
routing_stages(id, routing_id, seq, key, name_ar, name_en, station_id,
               std_minutes, qc_checklist_id, is_customer_visible,
               photo_before[OFF|OPTIONAL|REQUIRED],
               photo_after[OFF|OPTIONAL|REQUIRED],
               photo_min_count, photo_guide_url)

work_orders(id, code, order_line_id, product_id, variant_id, qty, routing_id,
            status, priority, planned_start, planned_end,
            actual_start, actual_end, supervisor_id)
work_order_stages(id, work_order_id, routing_stage_id, seq, status,
                  assigned_to, started_at, finished_at, actual_minutes,
                  blocked_reason, blocked_minutes)

stage_photos(id, work_order_stage_id, unit_label_id, work_order_id,
             kind[BEFORE|AFTER|ISSUE|EXTRA], url, thumb_url,
             width, height, bytes, captured_at, uploaded_at,
             actor_id, device_id, geo, client_event_id,
             is_customer_visible, caption)
unit_labels(id, work_order_id, serial, qr_payload, printed_at, current_stage_id, scrapped)

material_issues(id, work_order_id, material_id, qty_planned, qty_issued,
                qty_returned, issued_by, issued_at)

qc_checklists(id, name, items jsonb)          -- [{key, label_ar, label_en, type, required}]
qc_checks(id, work_order_stage_id, unit_label_id, checklist_id, result[PASS|FAIL],
          answers jsonb, defect_codes[], photo_urls[], inspector_id, checked_at)
rework_orders(id, work_order_id, from_stage_id, reason_code,
              attribution[WORKMANSHIP|MATERIAL_DEFECT|DESIGN_ERROR|SPEC_ERROR|CUSTOMER_CHANGE],
              extra_minutes, extra_material_cost, approved_by)

capacity_slots(id, station_id, date, minutes_capacity, minutes_booked)
```

## Logistics

```
transfer_requests(id, code, from_location_id, to_location_id, status,
                  requested_by, approved_by, reason)
transfer_lines(id, transfer_id, ref_type, ref_id, qty, unit_label_id)

shipments(id, code, kind[TO_CUSTOMER|TO_SHOWROOM|RETURN|REPAIR_PICKUP],
          order_id, from_location_id, to_location_id, driver_id, vehicle,
          status, scheduled_window, departed_at, arrived_at, failed_reason)
shipment_lines(id, shipment_id, unit_label_id, order_line_id, qty, loaded_at)
delivery_proofs(id, shipment_id, receiver_name, signature_url, photo_urls[],
                geo point, notes, captured_at)
installation_jobs(id, shipment_id, team_id, scheduled_at, status,
                  checklist jsonb, photo_urls[], completed_at)
```

## Cross-cutting

```
tracking_events(id, order_id, entity_type, entity_id, event_code, actor_id,
                location_id, station_id, payload jsonb, photo_urls[],
                occurred_at, recorded_at, is_customer_visible, client_event_id)

notification_rules(id, event_code, condition jsonb, recipient_roles[],
                   recipient_expr, channels[], template_key, quiet_hours,
                   throttle_minutes, is_active)
notifications(id, rule_id, recipient_user_id, recipient_contact, channel,
              template_key, payload jsonb, status, sent_at, read_at, error)

messages(id, order_id, author_id, body, attachment_urls[],
         visibility[INTERNAL|SHOWROOM|CUSTOMER], created_at)
after_sales_tickets(id, order_id, kind, description, status, sla_due_at,
                    assignee_id, resolution, closed_at)
approvals(id, kind, subject_type, subject_id, requested_by, amount,
          status, decided_by, decided_at, reason)
audit_log(id, actor_id, action, entity_type, entity_id, before jsonb,
          after jsonb, reason, ip, at)
attachments(id, entity_type, entity_id, url, mime, size, uploaded_by)
```

## Event codes

The vocabulary the notification rules and reports are written against. `*` marks
customer-visible by default.

| Group | Codes |
| --- | --- |
| Sales | `QUOTE_SENT`, `QUOTE_REVISED`, `QUOTE_EXPIRED`, `ORDER_CONFIRMED*`, `DEPOSIT_PAID*`, `ORDER_CANCELLED*`, `DISCOUNT_REQUESTED`, `DISCOUNT_APPROVED` |
| Custom | `BRIEF_CREATED`, `DESIGN_SUBMITTED*`, `DESIGN_CHANGE_REQUESTED`, `DESIGN_APPROVED*`, `PREVIEW_SENT*`, `PREVIEW_APPROVED*` |
| Factory handover | `FACTORY_ACCEPTED*`, `FACTORY_REJECTED`, `PROMISE_DATE_SET*`, `PROMISE_DATE_CHANGED*` |
| Production | `WO_CREATED`, `WO_SCHEDULED`, `PRODUCTION_STARTED*`, `STAGE_STARTED`, `STAGE_FINISHED`, `STAGE_BLOCKED`, `STAGE_UNBLOCKED`, `PRODUCTION_FINISHED*` |
| Stage photos | `STAGE_PHOTO_BEFORE`, `STAGE_PHOTO_AFTER*`, `STAGE_PHOTO_EXTRA`, `PHOTO_MISSING`, `PHOTO_UPLOAD_PENDING` |
| Quality | `QC_PASSED*`, `QC_FAILED`, `REWORK_RAISED`, `UNIT_SCRAPPED` |
| Materials | `MATERIAL_RESERVED`, `MATERIAL_SHORTAGE`, `MATERIAL_ISSUED`, `STOCK_BELOW_REORDER`, `PO_CREATED`, `PO_APPROVED`, `PO_RECEIVED`, `STOCK_VARIANCE` |
| Logistics | `PACKED*`, `TRANSFER_REQUESTED`, `TRANSFER_DISPATCHED`, `TRANSFER_RECEIVED`, `DELIVERY_SCHEDULED*`, `OUT_FOR_DELIVERY*`, `DELIVERED*`, `DELIVERY_FAILED*`, `INSTALLED*` |
| Finance | `PAYMENT_RECEIVED*`, `BALANCE_DUE*`, `INVOICE_ISSUED*`, `REFUND_ISSUED*` |
| Risk | `ORDER_AT_RISK`, `ORDER_LATE`, `SLA_BREACHED`, `IDLE_STATION`, `OVERRIDE_USED` |
| After-sales | `TICKET_OPENED*`, `TICKET_RESOLVED*`, `WARRANTY_EXPIRING*` |

## Indexes that matter

```
tracking_events (order_id, occurred_at desc)
tracking_events (event_code, occurred_at desc)
tracking_events (client_event_id) unique
stage_photos (work_order_stage_id, kind)
stage_photos (client_event_id) unique
stage_photos (uploaded_at) where uploaded_at is null   -- the pending-upload queue
work_order_stages (status, station_id)
order_lines (status, promised_date)
stock_items (ref_type, ref_id, location_id) unique
orders (tracking_token) unique
capacity_slots (station_id, date) unique
```
