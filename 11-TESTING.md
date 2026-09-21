# Testing Strategy

## 1. Testing pyramid

```text
             E2E
           /-----\
          /  API  \
         /---------\
        / Integration\
       /---------------\
      /      Unit       \
     /-------------------\
```

## 2. Unit tests
Target domain rules:
- available stock calculation
- reservation policy
- priority calculation
- state transitions
- return inspection outcomes

## 3. Integration tests
Target:
- repository behavior
- transaction behavior
- API authorization
- integration adapter mapping
- webhook idempotency

## 4. E2E tests
Critical paths:
1. Connect shop (or mocked connection flow).
2. Import order.
3. Validate stock.
4. Reserve stock.
5. Prioritize.
6. Create picking task.
7. Scan correct item.
8. Reject wrong item.
9. Complete packing.
10. Mark ready-to-ship.
11. Receive return.
12. Restock sellable return.

## 5. Acceptance criteria example

### Priority queue
Given:
- order A deadline 1 hour
- order B deadline 8 hours
- both have stock

When queue is calculated

Then:
- both appear in the queue
- A has higher urgency according to the configured rule
- explanation is available

Do not hard-code a "winner" in research documentation; the result depends on the configured criteria and measured data.

## 6. Performance checks
Measure:
- order list response
- inventory lookup
- scan validation
- queue calculation
- sync processing time

Use realistic test volumes.

## 7. Security tests
At minimum:
- unauthorized access
- cross-tenant access
- invalid role
- malformed input
- replayed webhook
- duplicate idempotency key
- secret exposure checks

## 8. Research evaluation
Recommended:
- pre/post task time
- error count
- SUS usability questionnaire
- user task completion rate

The research report must clearly distinguish observed measurements from assumptions.
