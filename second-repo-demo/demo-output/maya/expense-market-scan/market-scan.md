# Personal expense trackers: lightweight market scan

**As of September 27, 2026.** Snapshot of five US consumer products, using current vendor pages. Audience descriptions are positioning reads from the products’ own messaging; pricing and workflow notes reflect the linked pages and may change.

| Product | Audience / key promise | Pricing approach | Notable workflow |
|---|---|---|---|
| **YNAB** | People who want an intentional, proactive budget and more control over money. Promise: give every dollar a job and reduce second-guessing. | Paid subscription: **$109/year** or **$14.99/month**; 34-day trial. | Connect accounts, assign available money to categories/goals, then import and track spending against that plan. Sharing supports up to six people. [Pricing & method](https://www.ynab.com/pricing/) |
| **Monarch Money** | Individuals and households seeking one shared picture of their finances. Promise: track, budget, and plan in one place. | Paid subscription, **$99.99/year** on the linked pricing page; one tier includes core tracking, budgeting, and planning. | Aggregate accounts, review transactions and subscriptions, set goals, and collaborate with household members. [Pricing & features](https://partners.monarchmoney.com/pricing) |
| **Rocket Money** | Consumers trying to find recurring charges and reduce bills, with budgeting as a supporting tool. | Free entry tier; Premium uses a user-selected monthly price; Premium+ is **$15/month**. Bill negotiation may charge **35–60% of first-year savings** outside Premium+. | Connect accounts; identify subscriptions and upcoming bills; review spend; request a bill negotiation or subscription cancellation. [Plans & pricing](https://help.rocketmoney.com/en/articles/2217739-how-much-does-rocket-money-cost) · [Negotiation workflow](https://help.rocketmoney.com/en/articles/9744564-how-to-submit-a-bill-negotiation) |
| **Quicken Simplifi** | People wanting a flexible, low-friction view of what remains after regular obligations. Promise: always know what’s left to spend or save. | Subscription billed annually; currently advertised at **$3.99/month** for the first year (regular price shown as $6.99/month). | Build a monthly Spending Plan from income, bills, subscriptions, savings goals, and planned spending; transactions update the remaining amount as they arrive. [Product & pricing](https://www.quicken.com/products/simplifi/) · [Plan setup](https://support.simplifi.quicken.com/en/articles/14893966-how-to-set-up-the-spending-plan) |
| **Copilot Money** | Design-conscious users wanting a unified, automated view of spending and net worth across Apple devices and web. | Paid subscription: **$95/year** or **$13/month**, with a free trial. | Connect accounts; automatically categorize incoming transactions; review spending and investments from a unified dashboard. [Product & pricing](https://www.copilot.money/) · [How it works](https://www.copilot.money/faq) |

## Positioning openings for BudgetSight

BudgetSight’s current demo is a local, manual expense log with date, amount, category, and optional description; it supports month/category filtering, grouped summaries, deletion, and CSV export. That suggests three credible openings for this demo:

1. **A deliberately lightweight expense ledger.** Lead with quick entry and clear records for people who want to track spending without connecting bank accounts or setting up a full household finance system. Make the tradeoff explicit: no automatic imports in this demo.
2. **Useful answers from a small dataset.** Turn the existing monthly and category summaries into a simple “where did it go?” workflow: add an expense, filter the month, inspect category totals, and export when needed. This is a narrower job than forecasting or net-worth management.
3. **A transparent, portable record.** Emphasize local JSON storage and CSV export for users who value control and portability. Keep this claim specific to the demo’s local-file behavior rather than implying a security certification or cloud sync.

## Sources

- [YNAB pricing and workflow](https://www.ynab.com/pricing/)
- [Monarch Money pricing and features](https://partners.monarchmoney.com/pricing)
- [Rocket Money pricing](https://help.rocketmoney.com/en/articles/2217739-how-much-does-rocket-money-cost) and [bill negotiation workflow](https://help.rocketmoney.com/en/articles/9744564-how-to-submit-a-bill-negotiation)
- [Quicken Simplifi pricing and product](https://www.quicken.com/products/simplifi/) and [Spending Plan setup](https://support.simplifi.quicken.com/en/articles/14893966-how-to-set-up-the-spending-plan)
- [Copilot Money pricing and product](https://www.copilot.money/) and [workflow FAQ](https://www.copilot.money/faq)
- BudgetSight demo scope: repository [README](../../../README.md) and [expense tracker source](../../../expense_tracker.py)
