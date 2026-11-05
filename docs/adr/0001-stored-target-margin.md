# Every cost-priced item stores the margin it was priced at

A blank target margin used to mean "follow the default", so changing a default silently repriced every item that had been left blank. Now every save stores the margin actually used, with the price basis default filled in for a blank, and the existing blanks were set to 25, the default they had been priced at. A stored 25 can no longer be told apart from a typed one, so this can't be undone. Don't go back to blank-means-default, or the next change to a default reprices the old catalogue again.
