# Long-run average default rate for PD calibration

Estimate each grade's PD from the long-run average of its one-year default rates (Art. 180(1)(a) CRR), and show that the average reflects the likely range of variability of those rates, including downturn periods relevant to the portfolio (EBA/GL/2017/16 para 78). What counts as a long enough history is a matter of your own policy and the portfolio.

## What it rests on

- Art. 180(1)(a) CRR (law): PDs are estimated by obligor grade from long-run averages of one-year default rates.
  > "Institutions shall estimate PDs by obligor grade from long-run averages of one-year default rates." (Art. 180(1)(a) CRR)
- EBA/GL/2017/16 para 78 (EBA guideline): The calibration target must reflect the likely range of variability of one-year default rates, downturn periods included.
  > "the long-run average default rate used as the calibration target reflects the likely range of variability of one-year default rates" (EBA/GL/2017/16 para 78)

## What has to be shown

### R1. Estimate PDs by grade from long-run averages
Derive each grade's PD from the long-run average of its one-year default rates rather than from the latest year. Document the grades, the observation window and how the one-year rates are averaged.
Sources: Art. 180(1)(a) CRR.
A reviewer will ask to see: the grade-level default-rate series; the averaging method and its documentation.
Checks: PD long-run average derived from sufficient history.

### R2. Show the target reflects the range of variability
Show that the average used as the calibration target reflects how far one-year default rates move, including downturn periods relevant to the portfolio, and say what the history leaves out.
Sources: EBA/GL/2017/16 para 78.
A reviewer will ask to see: the observed range of one-year default rates; a statement of the downturn periods covered.
Checks: PD calibration tested per grade or pool.
Tests: Binomial test.

## Methods

- Average the grade-level one-year default rates over the full window (regulatory; Art. 180(1)(a) CRR): The estimate the law names, taken over every year of the window.
- Compare the target with an external default-rate series (market practice, not a regulatory requirement): A cross-check many institutions run; no provision asks for it.

## Pitfalls

- Using the most recent years only understates a downturn the window did not contain. (EBA/GL/2017/16 para 78)

## Not in this library

- The Commission Delegated Regulation on the IRB assessment methodology: It sets further requirements on the observation period that this topic does not reproduce.
