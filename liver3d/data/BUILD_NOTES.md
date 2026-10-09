# viewer/data build notes (consensus build, 2026-10-09)

Built with `nice $PY tools/build_viewer_data.py --source consensus --workers 1 --caps tools/viewer_face_caps.json`
(logs: `logs/viewer_build_consensus_{1..4}.log`). Source: only `consensus/<date>/masks`, plus two labelled extras below.
`scene.source = "consensus"`, three dates (May 2025, June 2026, Sep 2026), both registration modes (spine-anchored A1,
liver-anchored B1, from `registration.json`), growth maps for every lesion seen on two or more dates (liver-anchored).

## Post-fix handling applied before the build (no review round; labelled, non-destructive)
- **June C02, P3 patch.** The 1.00 mL right-mass medial-superior wall patch (component of the r1 active mask, 864 voxels,
  x289-303 y274-300 z202-212, placed by the 8 mm snap rule, 0.93 mL below SUV 2.12) was moved from `consensus/jun2026/masks/active.npy`
  to `consensus/jun2026/uncertain/active_P3_inferred.npy`. The r1 original is `consensus/jun2026/masks_pre_postfix/active.npy`.
  June active is now 29.59 mL. The viewer shows P3 only as the Uncertainty layer "FDG activity, inferred only" (confidence "inferred").
- No other mask was changed.

## Confidence labels (scene `per_date.confidence`; shown in Layers rows, the canvas volume legend, tooltips and the lesion table)
| structure | May 2025 | June 2026 | Sep 2026 |
|---|---|---|---|
| Couinaud segments | partly inferred (inside tumour; S2/S3 by a geometric LHV plane) | inferred (automatic; not vessel-guided) | inferred (automatic; not vessel-guided) |
| hepatic veins | incomplete (r2-C01) | low confidence; LHV vs left lesion: touches, encirclement not established (C01) | low confidence (C03) |
| FDG-active outside CT lesions (new derived layer) | — (no activity) | PET-defined only, 5.47 mL | PET-defined only, 18.5 mL |
| P3 inferred activity | — | inferred (C02) | — |
| mural nodules | — | not visible | PET-defined only (iso-50 %, C06) |
| lesion P7 | — | — | PET-defined only (C05) |
| lesions K, N | low confidence | (match: uncertain) | — |
| portal vein | | | registered from June; not observed |
The old June wording about the left hepatic vein ("3.2 mm ... not encircled") appears nowhere in scene.json, report_claims.json or the page
(checked in every browser test). The LHV vessel-relation claims carry `model_relation` with the C01 wording.

## Lesion IDs across dates
From the consensus `lesion_ids` labels and the May `cross_date_id_policy`: R1, L1, S8 (S7/8 dome) labels 1-3 on all dates; S7sat = May/June 4;
S1 caudate = May/June 5 and Sep 4 (provisional, C09); K = May/June 6, N = May/June 7 (uncertain); P7 = Sep 5 (new, provisional).
Claim IDs S4a-7 -> N and S4b -> K (uncertain) are mapped as stated in lesion_ids.json. 33 of 67 claims carry a model measurement.

## Mesh fidelity and the size budget
Recipe: tools/meshes.py (marching cubes on the native grid, x3 z interpolation, Taubin 30/20/10, pass band 0.1, normalize_coordinates=True),
every mesh voxelised back and compared with its mask. **All 111 meshes pass Dice >= 0.98 (min 0.9806, June R1 calcifications, undecimated).**

Undecimated, the scene was 340 MB (9.9 M faces). Two size measures, in this order:
1. Union meshes of cores / walls / nodules / calcifications are no longer written when every voxel lies inside a lesion: the viewer
   shows the per-lesion part meshes instead and never drew the union (scene `per_date.shown_as`). Saved ~80 MB, no fidelity change.
2. Per-structure face caps (`tools/viewer_face_caps.json`), large organs only: liver 400k, segments 120k each, per-lesion walls 600k,
   per-lesion cores 400k. Decimated (decimate_pro, topology preserved, then verified): liver May/June, segments May S3-S8 and June S2-S8,
   June R1 cores and R1 walls. Their Dice after decimation: liver 0.9979/0.9977, segments >= 0.9975, June R1 cores 0.9956, R1 walls 0.9825.
   Lesion surfaces, active tissue, nodules, calcifications, vessels and all of Sep are unreduced.

Result: meshes 199.4 MB (7.98 M faces) + growth maps 19.3 MB + JSON 0.5 MB = **~220 MB**. `data/old/` (archived earlier meshes, 82 MB)
is not referenced by the scene and need not be deployed.

## Memory
`--workers 1` and lesion statistics computed before the mesh pool starts (one heavy process at a time). Run 1 peaked at 5.1 GB in the
main process during the statistics; `compute_stats` now keeps one lesion-union mask instead of one mask per lesion.

## Per-mesh table
| date | mesh | faces | Dice | p95 mm | MB |
|---|---|---|---|---|---|
| jun2026 | active | 45,820 | 0.9913 | 0.36 | 1.15 |
| jun2026 | active_inferred | 5,168 | 0.9872 | 0.32 | 0.13 |
| jun2026 | active_pet_only | 20,572 | 0.9896 | 0.33 | 0.51 |
| jun2026 | contact_left_portal | 4,664 | 1.0000 | 0.24 | 0.12 |
| jun2026 | gallbladder | 16,488 | 0.9873 | 0.31 | 0.41 |
| jun2026 | hepatic_veins | 67,526 | 0.9909 | 0.31 | 1.69 |
| jun2026 | ivc | 46,480 | 0.9956 | 0.29 | 1.16 |
| jun2026 | lesion_K | 700 | 0.9952 | 0.28 | 0.02 |
| jun2026 | lesion_K_cores | 348 | 1.0000 | 0.29 | 0.01 |
| jun2026 | lesion_K_walls | 1,014 | 1.0000 | 0.20 | 0.03 |
| jun2026 | lesion_L1 | 31,786 | 0.9987 | 0.31 | 0.80 |
| jun2026 | lesion_L1_active | 27,972 | 0.9982 | 0.33 | 0.70 |
| jun2026 | lesion_L1_cores | 33,654 | 0.9934 | 0.33 | 0.84 |
| jun2026 | lesion_L1_walls | 65,690 | 0.9859 | 0.33 | 1.64 |
| jun2026 | lesion_N | 796 | 1.0000 | 0.30 | 0.02 |
| jun2026 | lesion_N_cores | 48 | 1.0000 | 0.27 | 0.00 |
| jun2026 | lesion_N_walls | 844 | 0.9924 | 0.34 | 0.02 |
| jun2026 | lesion_R1 | 344,490 | 0.9984 | 0.36 | 8.61 |
| jun2026 | lesion_R1_active | 10,054 | 0.9860 | 0.29 | 0.25 |
| jun2026 | lesion_R1_calcifications | 1,676 | 0.9808 | 0.30 | 0.04 |
| jun2026 | lesion_R1_cores | 400,000 | 0.9956 | 0.39 | 9.99 |
| jun2026 | lesion_R1_walls | 600,000 | 0.9825 | 0.33 | 14.94 |
| jun2026 | lesion_S1 | 2,688 | 0.9890 | 0.34 | 0.07 |
| jun2026 | lesion_S1_cores | 156 | 1.0000 | 0.21 | 0.00 |
| jun2026 | lesion_S1_walls | 2,848 | 0.9868 | 0.35 | 0.07 |
| jun2026 | lesion_S7sat | 2,144 | 0.9966 | 0.29 | 0.05 |
| jun2026 | lesion_S7sat_cores | 1,398 | 0.9961 | 0.33 | 0.04 |
| jun2026 | lesion_S7sat_walls | 3,514 | 0.9956 | 0.26 | 0.09 |
| jun2026 | lesion_S8 | 53,054 | 0.9992 | 0.32 | 1.33 |
| jun2026 | lesion_S8_cores | 102,752 | 0.9881 | 0.35 | 2.57 |
| jun2026 | lesion_S8_walls | 154,200 | 0.9939 | 0.28 | 3.84 |
| jun2026 | liver | 399,998 | 0.9977 | 0.42 | 10.00 |
| jun2026 | portal | 112,634 | 0.9838 | 0.34 | 2.82 |
| jun2026 | seg1 | 93,060 | 0.9956 | 0.31 | 2.33 |
| jun2026 | seg2 | 120,000 | 0.9981 | 0.37 | 3.00 |
| jun2026 | seg3 | 120,000 | 0.9980 | 0.34 | 3.00 |
| jun2026 | seg4 | 120,000 | 0.9984 | 0.31 | 3.00 |
| jun2026 | seg5 | 120,000 | 0.9979 | 0.35 | 3.00 |
| jun2026 | seg6 | 120,000 | 0.9978 | 0.38 | 3.00 |
| jun2026 | seg7 | 120,000 | 0.9977 | 0.37 | 3.00 |
| jun2026 | seg8 | 120,000 | 0.9975 | 0.36 | 3.00 |
| may2025 | contact_left_portal | 3,308 | 1.0000 | 0.21 | 0.08 |
| may2025 | gallbladder | 13,196 | 0.9971 | 0.32 | 0.33 |
| may2025 | hepatic_veins | 50,608 | 0.9954 | 0.34 | 1.27 |
| may2025 | ivc | 73,868 | 0.9944 | 0.31 | 1.85 |
| may2025 | lesion_K | 488 | 0.9926 | 0.31 | 0.01 |
| may2025 | lesion_K_cores | 224 | 1.0000 | 0.29 | 0.01 |
| may2025 | lesion_K_walls | 646 | 1.0000 | 0.30 | 0.02 |
| may2025 | lesion_L1 | 25,018 | 0.9950 | 0.36 | 0.63 |
| may2025 | lesion_L1_cores | 25,018 | 0.9950 | 0.36 | 0.63 |
| may2025 | lesion_N | 364 | 1.0000 | 0.30 | 0.01 |
| may2025 | lesion_N_walls | 364 | 1.0000 | 0.30 | 0.01 |
| may2025 | lesion_R1 | 331,110 | 0.9980 | 0.37 | 8.28 |
| may2025 | lesion_R1_calcifications | 3,110 | 1.0000 | 0.19 | 0.08 |
| may2025 | lesion_R1_cores | 380,976 | 0.9974 | 0.37 | 9.53 |
| may2025 | lesion_R1_nodules | 4,124 | 0.9959 | 0.30 | 0.10 |
| may2025 | lesion_R1_walls | 570,292 | 0.9980 | 0.19 | 14.19 |
| may2025 | lesion_S1 | 2,184 | 0.9992 | 0.31 | 0.05 |
| may2025 | lesion_S1_cores | 348 | 1.0000 | 0.21 | 0.01 |
| may2025 | lesion_S1_walls | 2,544 | 0.9913 | 0.34 | 0.06 |
| may2025 | lesion_S7sat | 2,176 | 0.9877 | 0.35 | 0.05 |
| may2025 | lesion_S7sat_cores | 1,672 | 0.9806 | 0.35 | 0.04 |
| may2025 | lesion_S7sat_walls | 2,746 | 0.9851 | 0.30 | 0.07 |
| may2025 | lesion_S8 | 51,822 | 0.9976 | 0.36 | 1.30 |
| may2025 | lesion_S8_cores | 65,156 | 0.9954 | 0.37 | 1.63 |
| may2025 | lesion_S8_walls | 76,766 | 0.9873 | 0.30 | 1.91 |
| may2025 | liver | 399,998 | 0.9979 | 0.42 | 10.00 |
| may2025 | portal | 30,300 | 0.9980 | 0.33 | 0.76 |
| may2025 | seg1 | 83,442 | 0.9969 | 0.31 | 2.09 |
| may2025 | seg2 | 115,054 | 0.9975 | 0.41 | 2.88 |
| may2025 | seg3 | 120,000 | 0.9989 | 0.39 | 3.00 |
| may2025 | seg4 | 119,998 | 0.9988 | 0.30 | 3.00 |
| may2025 | seg5 | 120,000 | 0.9981 | 0.35 | 3.00 |
| may2025 | seg6 | 120,000 | 0.9981 | 0.37 | 3.00 |
| may2025 | seg7 | 120,000 | 0.9985 | 0.36 | 3.00 |
| may2025 | seg8 | 120,000 | 0.9986 | 0.35 | 3.00 |
| sep2026 | active | 58,522 | 0.9904 | 0.56 | 1.46 |
| sep2026 | active_pet_only | 22,832 | 0.9894 | 0.50 | 0.57 |
| sep2026 | hepatic_veins | 17,874 | 0.9882 | 0.56 | 0.45 |
| sep2026 | ivc | 27,998 | 0.9972 | 0.47 | 0.70 |
| sep2026 | lesion_L1 | 15,138 | 0.9968 | 0.52 | 0.38 |
| sep2026 | lesion_L1_active | 14,888 | 0.9956 | 0.53 | 0.37 |
| sep2026 | lesion_L1_cores | 3,652 | 0.9847 | 0.53 | 0.09 |
| sep2026 | lesion_L1_walls | 18,658 | 0.9954 | 0.52 | 0.47 |
| sep2026 | lesion_P7 | 456 | 0.9848 | 0.48 | 0.01 |
| sep2026 | lesion_P7_active | 456 | 0.9848 | 0.48 | 0.01 |
| sep2026 | lesion_P7_walls | 456 | 0.9848 | 0.48 | 0.01 |
| sep2026 | lesion_R1 | 111,276 | 0.9992 | 0.54 | 2.78 |
| sep2026 | lesion_R1_active | 31,960 | 0.9872 | 0.56 | 0.80 |
| sep2026 | lesion_R1_calcifications | 906 | 1.0000 | 0.36 | 0.02 |
| sep2026 | lesion_R1_cores | 121,676 | 0.9979 | 0.57 | 3.04 |
| sep2026 | lesion_R1_nodules | 440 | 1.0000 | 0.49 | 0.01 |
| sep2026 | lesion_R1_walls | 195,250 | 0.9858 | 0.51 | 4.87 |
| sep2026 | lesion_S1 | 1,372 | 0.9882 | 0.46 | 0.03 |
| sep2026 | lesion_S1_cores | 792 | 0.9923 | 0.53 | 0.02 |
| sep2026 | lesion_S1_walls | 1,874 | 1.0000 | 0.36 | 0.05 |
| sep2026 | lesion_S8 | 18,724 | 0.9989 | 0.52 | 0.47 |
| sep2026 | lesion_S8_active | 7,536 | 0.9924 | 0.56 | 0.19 |
| sep2026 | lesion_S8_cores | 20,804 | 0.9952 | 0.57 | 0.52 |
| sep2026 | lesion_S8_nodules | 2,256 | 0.9935 | 0.53 | 0.06 |
| sep2026 | lesion_S8_walls | 23,772 | 0.9912 | 0.49 | 0.59 |
| sep2026 | liver | 229,722 | 0.9984 | 0.58 | 5.74 |
| sep2026 | portal | 7,476 | 0.9938 | 0.55 | 0.19 |
| sep2026 | seg1 | 25,548 | 0.9869 | 0.54 | 0.64 |
| sep2026 | seg2 | 70,074 | 0.9975 | 0.59 | 1.75 |
| sep2026 | seg3 | 46,972 | 0.9961 | 0.60 | 1.17 |
| sep2026 | seg4 | 40,536 | 0.9956 | 0.52 | 1.01 |
| sep2026 | seg5 | 79,100 | 0.9970 | 0.54 | 1.98 |
| sep2026 | seg6 | 67,024 | 0.9976 | 0.58 | 1.68 |
| sep2026 | seg7 | 98,968 | 0.9985 | 0.55 | 2.47 |
| sep2026 | seg8 | 66,998 | 0.9968 | 0.54 | 1.68 |

Total: 111 meshes, 7,983,142 faces, 199.4 MB; growth maps 15 files 19.3 MB; min Dice 0.9806
