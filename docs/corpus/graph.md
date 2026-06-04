---
title: Corpus graph
---

# Corpus graph

> **Auto-generated** by `bun run graph` from the bundled demo corpus — do not edit by hand. Regenerate whenever corpus data changes.

A map of how the loaded records reference each other. Node shapes encode the surface, so it reads the same in light and dark themes:

- **Regulation** — rectangle
- **Check** — rounded
- **Test** — hexagon
- **Playbook** — subroutine box

Solid arrows are `Regulation.children` (sub-regulations plus the checks/tests that operationalize a record). Dotted arrows are playbook phase references reaching across surfaces.

```mermaid
flowchart LR
  subgraph Regulation
    regulation___crr_180["CRR Article 180"]
    regulation___crr_180_1_a["CRR Article 180(1)(a)"]
    regulation___eba_gl_2017_16_s4["EBA GL 2017/16 Section 4 — Requirements related to PD estimation"]
    regulation___eba_gl_2017_16_78["EBA GL 2017/16 paragraph 78"]
    regulation___crr_178_1_a["CRR Article 178(1)(a)"]
    regulation___crr_178_1_b["CRR Article 178(1)(b)"]
  end
  subgraph Check
    check___calibration_pd_lra_derived("PD long-run average derived from sufficient history")
    check___calibration_pd_segment_tested("PD calibration tested per grade or pool")
    check___default_definition_90dpd("Default definition includes 90 DPD backstop")
    check___default_definition_utp("Default definition includes unlikely-to-pay (UTP) triggers")
  end
  subgraph Test
    test___jeffreys{{"Jeffreys test"}}
    test___binomial{{"Binomial test"}}
    test___hosmer_lemeshow{{"Hosmer-Lemeshow test"}}
  end
  subgraph Playbook
    playbook___calibration[["calibration"]]
    playbook___calibration_pd[["calibration/pd"]]
  end
  regulation___crr_180 --> regulation___crr_180_1_a
  regulation___crr_180 --> check___calibration_pd_segment_tested
  regulation___crr_180_1_a --> check___calibration_pd_lra_derived
  regulation___eba_gl_2017_16_s4 --> regulation___eba_gl_2017_16_78
  regulation___eba_gl_2017_16_78 --> test___jeffreys
  regulation___eba_gl_2017_16_78 --> test___binomial
  regulation___eba_gl_2017_16_78 --> test___hosmer_lemeshow
  playbook___calibration_pd -.-> regulation___crr_180_1_a
  playbook___calibration_pd -.-> regulation___eba_gl_2017_16_78
  playbook___calibration_pd -.-> check___calibration_pd_lra_derived
  playbook___calibration_pd -.-> test___jeffreys
  playbook___calibration_pd -.-> test___binomial
  playbook___calibration_pd -.-> test___hosmer_lemeshow
  playbook___calibration_pd -.-> check___calibration_pd_segment_tested
```
