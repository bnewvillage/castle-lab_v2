# Castle Lab pricing

How the catalogue's selling prices are set for every market the company sells in,
and kept in step with the ERP.

## Pricing an item

**Price basis**:
What an item's UAE price is worked out from: one of the vendor's MSRPs (primary or
secondary, with or without VAT) after the brand markup, or its cost at a target margin.
_Avoid_: price used, MSRP source, pricing method

**Cost + margin**:
The price basis that sets the price at a target margin on the item's EXW cost alone,
leaving shipping and customs out.
_Avoid_: cost based (in prose)

**Landed cost + margin**:
The price basis that sets the price at a target margin on the item's landed cost.
_Avoid_: landed cost based (in prose)

**Landed cost**:
An item's cost delivered to the UAE, in AED: EXW cost plus shipping, converted at the
stored rate, plus customs duty.

**Target margin**:
The gross margin a cost-priced item is set at, as a share of its selling price. When none
is given it defaults by price basis: 45% on Cost + margin, 40% on Landed cost + margin,
and 25% for project items. A default fills in a blank when an item is priced, and the
margin it was priced at is kept with the item, so a later change of default never
reprices it.

**Brand markup**:
The markup a brand puts on a vendor MSRP to reach the base UAE price.

**Additional markup**:
A brand's markup on top of the base price, applied once to the unrounded base whatever
the price basis; the result is the selling price.

## Markets

**Market**:
A country the company prices for: UAE, KSA, Qatar or Kuwait.

**Derived market**:
Any market other than UAE, whose price comes from the rounded UAE price by its own rule.

**Shelf price**:
The price a customer sees, VAT included where the market has VAT; it is what the
rounding rule rounds.

**Override**:
A market price set by hand and flagged so, which no recalculation touches. The flag is
the only thing that makes a price deliberate.
_Avoid_: hand-set, manual price, pinned

**Out of step**:
A derived market price that isn't an override and differs from what its UAE price gives
today. It is not deliberate: recalculating moves it, and shows it first.
_Avoid_: stale, drifted

## Project items

**Project item**:
An item priced for a quotation, kept apart from the catalogue under the PRJT code prefix.
It is priced on landed cost + margin and has no brand markup of any kind.
_Avoid_: PRJT item, project SKU
