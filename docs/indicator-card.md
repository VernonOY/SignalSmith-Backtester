# Indicator Card Sizing

The indicator cards in the sidebar are laid out using the `.indicator-grid` CSS rule in `frontend/src/styles.css`. Each card is assigned a maximum width via the shared `--sidebar-section-double` variable:

```
--sidebar-section-double: calc(
  var(--sidebar-section-min-width) * 2 + var(--sidebar-section-gap)
);
```

With the current values `--sidebar-section-min-width: 260px` and `--sidebar-section-gap: 8px`, the calculated maximum width for each indicator card is:

```
max-width = 260px * 2 + 8px = 528px
```

Therefore, `.indicator-card` effectively has a `max-width` of **528px**.
