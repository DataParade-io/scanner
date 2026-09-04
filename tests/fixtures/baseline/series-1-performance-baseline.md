# Series-1 performance baseline (reference)

Schema: performance-baseline/1
Role: reference (immutable — do not overwrite)
Label: develop-6d241f8-reference
Captured: 2026-09-03T13:00:43.178Z
Scanner commit: 6d241f8dd9a822a975a54e98f483096261d60aac
Review states: accepted
Materialized packets: 29

## Headline metrics

| Layer | Recall | Precision |
| --- | --- | --- |
| mentions | 41.8% (33/79) | 0.9% (33/3693) |
| data-items | 27.1% (38/140) | 36.5% (38/104) |
| components | 0.6% (3/519) | 13.6% (3/22) |
| data-flows | 0.0% (0/158) | 0.0% (0/13) |

---

# Scanner scorecard vector

Contract: scorecard-vector/2
Generated: 2026-09-03T13:00:43.178Z
Scanner: 6d241f8dd9a822a975a54e98f483096261d60aac
Review states: accepted
Packets: 29

## Headline layers (no cross-layer scalar)

### mentions
- Summary: scorable
- Gate: scorable
- Recall: 41.8% [computable; 33/79]
- Ancestor recall: 0.0% [computable; 0/79]
- Precision: 0.9% [computable; 33/3693]
- Negative pass rate: n/a [migration_incomplete_or_not_ready; 0/0]
- Scope: reviewedFiles=188, processedFiles=136, locationlessFindings=0
- Denominators: evaluablePositives=79, exhaustiveScopedFindings=3693
- Population: acceptedCanonical=79, evaluable=79, matched=33
- Coverage: entityWeighted=60/79, distinctFiles=30/48
- Migration incomplete: 278

### data-items
- Summary: scorable
- Gate: scorable
- Recall: 27.1% [computable; 38/140]
- Ancestor recall: 0.0% [computable; 0/140]
- Precision: 36.5% [computable; 38/104]
- Negative pass rate: n/a [migration_incomplete_or_not_ready; 0/0]
- Scope: reviewedFiles=190, processedFiles=138, locationlessFindings=0
- Denominators: evaluablePositives=140, exhaustiveScopedFindings=104
- Population: acceptedCanonical=0, evaluable=140, matched=38
- Coverage: entityWeighted=0/0, distinctFiles=36/52

### components
- Summary: scorable
- Gate: scorable
- Recall: 0.6% [computable; 3/519]
- Ancestor recall: 0.0% [computable; 0/519]
- Precision: 13.6% [computable; 3/22]
- Negative pass rate: n/a [migration_incomplete_or_not_ready; 0/0]
- Scope: reviewedFiles=429, processedFiles=270, locationlessFindings=16
- Denominators: evaluablePositives=519, exhaustiveScopedFindings=22
- Population: acceptedCanonical=519, evaluable=519, matched=3
- Coverage: entityWeighted=284/519, distinctFiles=203/355

### data-flows
- Summary: scorable
- Gate: scorable
- Recall: 0.0% [computable; 0/158]
- Ancestor recall: 0.0% [computable; 0/158]
- Precision: 0.0% [computable; 0/13]
- Negative pass rate: n/a [migration_incomplete_or_not_ready; 0/0]
- Scope: reviewedFiles=247, processedFiles=188, locationlessFindings=58
- Denominators: evaluablePositives=158, exhaustiveScopedFindings=13
- Population: acceptedCanonical=0, evaluable=158, matched=0
- Coverage: entityWeighted=0/0, distinctFiles=55/81

## Packet: auth0-express

### mentions
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=3, evaluable=3, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: directus

### mentions
- acceptedCanonical=2, evaluable=2, matched=2
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=5, matched=4
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=13, evaluable=13, matched=1
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=6, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: discourse

### mentions
- acceptedCanonical=11, evaluable=11, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=11, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=156, evaluable=156, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=16, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: drupal

### mentions
- acceptedCanonical=3, evaluable=3, matched=1
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=6, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=16, evaluable=16, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=2, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: easy-school

### mentions
- acceptedCanonical=2, evaluable=2, matched=2
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=6, matched=4
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=3, evaluable=3, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=1, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: exposed

### mentions
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: flask-login

### mentions
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: ghost

### mentions
- acceptedCanonical=4, evaluable=4, matched=4
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=5, matched=2
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=16, evaluable=16, matched=1
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=7, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: gitea

### mentions
- acceptedCanonical=1, evaluable=1, matched=1
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=5, matched=1
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=1, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: hyperswitch-vault

### mentions
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=1, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: keycloak

### mentions
- acceptedCanonical=1, evaluable=1, matched=1
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=4, matched=4
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=3, evaluable=3, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=1, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: magento

### mentions
- acceptedCanonical=4, evaluable=4, matched=3
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=9, matched=2
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=78, evaluable=78, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=42, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: medusa

### mentions
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=15, evaluable=15, matched=1
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=12, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: medusa-customer

### mentions
- acceptedCanonical=4, evaluable=4, matched=4
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=8, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=5, evaluable=5, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=1, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: nopcommerce

### mentions
- acceptedCanonical=6, evaluable=6, matched=1
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=11, matched=5
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=13, evaluable=13, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=9, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: orchard-core

### mentions
- acceptedCanonical=4, evaluable=4, matched=2
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=7, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=16, evaluable=16, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=3, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: ory-kratos-password

### mentions
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=1, evaluable=1, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: pocketbase

### mentions
- acceptedCanonical=5, evaluable=5, matched=3
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=7, matched=2
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=18, evaluable=18, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=7, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: posthog-user

### mentions
- acceptedCanonical=2, evaluable=2, matched=2
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=2, matched=1
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=1, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: redmine

### mentions
- acceptedCanonical=3, evaluable=3, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=5, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=18, evaluable=18, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=12, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: saleor

### mentions
- acceptedCanonical=3, evaluable=3, matched=2
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=7, matched=1
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=1, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: spree

### mentions
- acceptedCanonical=4, evaluable=4, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=8, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=16, evaluable=16, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=9, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: spring-petclinic

### mentions
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=4, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=4, evaluable=4, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: strapi

### mentions
- acceptedCanonical=3, evaluable=3, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=5, matched=3
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=14, evaluable=14, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=7, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: supabase-js

### mentions
- acceptedCanonical=6, evaluable=6, matched=4
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=4, matched=1
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=3, evaluable=3, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: vapor

### mentions
- acceptedCanonical=1, evaluable=1, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=2, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=1, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: vgs-django

### mentions
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=1, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=2, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: wordpress

### mentions
- acceptedCanonical=6, evaluable=6, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=11, matched=5
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=90, evaluable=90, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=16, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Packet: yjdh-employee

### mentions
- acceptedCanonical=2, evaluable=2, matched=1
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-items
- acceptedCanonical=0, evaluable=7, matched=3
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

### components
- acceptedCanonical=2, evaluable=2, matched=0
- unread: 0 (0.0%)
- capability (diagnostic): 0.0% case-weighted

### data-flows
- acceptedCanonical=0, evaluable=0, matched=0
- unread: 0 (n/a)
- capability (diagnostic): 0.0% case-weighted

## Diagnostic: raw-hits (not in headline vector)
- Recall: n/a
- Precision: n/a
- Denominators: evaluablePositives=0
