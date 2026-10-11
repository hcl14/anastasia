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

## Compare-mode registration (2026-10-09, `tools/registration_refine.py`, `tools/add_registration_modes.py`)
Problem: in Compare the ghost (earlier date) did not sit on the current structures (breathing: right dome 69 / 89 / 78 mm above T12).
New alignment modes, all computed on the consensus masks on the native grids (SimpleITK, shrink 4/2/1 with smoothing for the optimisation;
every number below is measured at full resolution), rigid only, nothing scaled or warped:
- **Liver (mask fit, refined)** — new DEFAULT: rigid fit maximising the overlap of the two liver masks (MeanSquares on the masks),
  initialised from B1; Compare May -> June uses a direct May -> June fit (`pair_matrix`), June -> Sep / May -> Sep are the per-date matrices.
  13 perturbed starts (±8 mm, ±6°) converge to the same optimum: ~0.935 liver Dice is the rigid ceiling.
- **Lesion R1 / L1 / S8**: rigid fit of that lesion's masks alone, initialised by the centroids + the liver rotation; translation only
  unless a full rigid fit gains >= 0.01 Dice within 8° (only S8 June -> Sep; L1 June -> Sep wanted a 24° turn, refused).
  The lesion grows in place; everything else follows the same transform. Selecting another lesion in a lesion mode re-anchors.
- Spine-anchored (A1) and Liver (landmark fit, B1) are kept unchanged.
- Growth maps follow the mode: base set = B1 (spine and B1 modes); `growth_sets.liver_refined`; `growth_sets.lesion` (R1/L1/S8 own fit,
  small lesions with the refined liver fit). +36 MB of growth meshes.
- **Rejected: non-rigid liver warp** (SimpleITK B-spline over the refined rigid, on the liver masks; the viewer code for a displacement grid on the
  ghost vertices exists and was tested with this field, but no mode ships it). Liver Dice rises to ~0.97, but lesion volumes are distorted
  beyond the 3 % limit and S8 overlap gets worse than rigid — a liver-driven warp would fake or hide growth. 4x4x4 control mesh: lesion
  volumes -28 % .. +28 %, det J 0.19..2.9; 2x2x2 mesh numbers below.

Definitions: Dice of the mapped earlier mask with the later mask (later space, integrated over the earlier voxels); surface = pooled symmetric
boundary distance; centroid = |T(earlier centroid) - later centroid| (includes real asymmetric growth); spine TRE = 4 vertebral landmarks,
dome z = right liver dome height error (registration.json landmarks). Lesions grow, so lesion Dice < 1 even when perfectly placed.
Full numbers: `viewer/data/registration_quality.json`.

**may2025 -> jun2026**

| mode | liver Dice | liver surf mean/p95 mm | R1 Dice / centroid mm | L1 Dice / centroid mm | S8 Dice / centroid mm | spine TRE mm | dome z mm |
|---|---|---|---|---|---|---|---|
| Spine (A1) | 0.847 | 7.4 / 19.6 | 0.820 / 16.0 | 0.455 / 11.3 | 0.317 / 20.1 | 1.7 | 16.2 |
| Liver landmark (B1) | 0.920 | 3.4 / 8.4 | 0.931 / 3.0 | 0.712 / 4.9 | 0.578 / 13.2 | 23.1 | 5.6 |
| **Liver mask fit (refined, default)** | 0.935 | 3.0 / 8.0 | 0.950 / 1.1 | 0.697 / 5.5 | 0.750 / 5.9 | 16.5 | 2.4 |
| Lesion R1 | 0.934 | 3.0 / 8.3 | 0.951 / 0.5 | 0.681 / 6.1 | 0.741 / 6.4 | 15.7 | 2.8 |
| Lesion L1 | 0.902 | 4.1 / 10.0 | 0.909 / 6.2 | 0.777 / 0.3 | 0.556 / 10.5 | 16.4 | 5.4 |
| Lesion S8 | 0.913 | 3.6 / 9.2 | 0.914 / 6.7 | 0.544 / 10.2 | 0.920 / 0.7 | 21.2 | 1.3 |

**jun2026 -> sep2026**

| mode | liver Dice | liver surf mean/p95 mm | R1 Dice / centroid mm | L1 Dice / centroid mm | S8 Dice / centroid mm | spine TRE mm | dome z mm |
|---|---|---|---|---|---|---|---|
| Spine (A1) | 0.883 | 5.5 / 11.0 | 0.890 / 8.6 | 0.529 / 12.4 | 0.641 / 8.1 | 1.7 | 9.7 |
| Liver landmark (B1) | 0.934 | 2.9 / 7.6 | 0.919 / 4.3 | 0.610 / 6.4 | 0.849 / 4.3 | 9.4 | 2.5 |
| **Liver mask fit (refined, default)** | 0.936 | 2.9 / 7.3 | 0.923 / 3.4 | 0.606 / 5.7 | 0.810 / 6.5 | 8.7 | 1.0 |
| Lesion R1 | 0.932 | 3.0 / 7.6 | 0.927 / 1.4 | 0.586 / 7.0 | 0.808 / 6.2 | 7.2 | 2.4 |
| Lesion L1 | 0.887 | 5.2 / 12.2 | 0.848 / 11.0 | 0.696 / 4.2 | 0.590 / 15.6 | 16.9 | 6.5 |
| Lesion S8 | 0.898 | 4.5 / 11.4 | 0.903 / 4.5 | 0.495 / 9.3 | 0.909 / 0.2 | 19.7 | 0.9 |

**may2025 -> sep2026** (not shown by Compare; for reference)

| mode | liver Dice | liver surf mean/p95 mm | R1 Dice / centroid mm | L1 Dice / centroid mm | S8 Dice / centroid mm | spine TRE mm | dome z mm |
|---|---|---|---|---|---|---|---|
| Spine (A1) | 0.879 | 5.3 / 13.0 | 0.883 / 8.3 | 0.336 / 13.7 | 0.511 / 15.2 | 3.0 | 6.2 |
| Liver landmark (B1) | 0.927 | 3.1 / 7.1 | 0.911 / 4.3 | 0.490 / 8.3 | 0.561 / 14.0 | 16.5 | 2.4 |
| **Liver mask fit (refined, default)** | 0.930 | 3.0 / 6.9 | 0.917 / 3.3 | 0.496 / 8.6 | 0.652 / 10.5 | 14.2 | 0.6 |
| Lesion R1 | 0.924 | 3.2 / 7.5 | 0.919 / 1.2 | 0.490 / 8.4 | 0.608 / 12.6 | 12.5 | 0.6 |
| Lesion L1 | 0.867 | 6.5 / 16.4 | 0.843 / 13.8 | 0.558 / 4.8 | 0.277 / 22.7 | 10.4 | 13.4 |
| Lesion S8 | 0.872 | 4.9 / 13.8 | 0.835 / 13.5 | 0.330 / 18.6 | 0.881 / 0.8 | 25.1 | 6.2 |

Non-rigid candidate (B-spline 2x2x2 on the liver masks, NOT shipped): may2025__jun2026: liver Dice 0.9745, R1 Dice 0.9641 vol +2.2 %, L1 Dice 0.7792 vol +12.9 %, S8 Dice 0.7589 vol +24.5 %, det J 0.802..1.617; jun2026__sep2026: liver Dice 0.9683, R1 Dice 0.9055 vol -8.4 %, L1 Dice 0.693 vol -2.7 %, S8 Dice 0.5408 vol +4.2 %, det J 0.622..1.284

| shown (ghost) | mode | liver | R1 | L1 | S8 |
|---|---|---|---|---|---|
| jun2026 (may2025) | before: skeleton | 0.84 | 0.80 | 0.53 | 0.49 |
| jun2026 (may2025) | before: liver | 0.92 | 0.92 | 0.73 | 0.58 |
| sep2026 (jun2026) | before: skeleton | 0.90 | 0.89 | 0.58 | 0.68 |
| sep2026 (jun2026) | before: liver | 0.93 | 0.90 | 0.61 | 0.84 |
| jun2026 (may2025) | after: liver_refined | 0.93 | 0.93 | 0.71 | 0.76 |
| jun2026 (may2025) | after: lesion_R1 | 0.93 | 0.93 | 0.70 | 0.75 |
| jun2026 (may2025) | after: lesion_L1 | 0.91 | 0.89 | 0.80 | 0.62 |
| jun2026 (may2025) | after: lesion_S8 | 0.90 | 0.89 | 0.56 | 0.91 |
| sep2026 (jun2026) | after: liver_refined | 0.93 | 0.90 | 0.61 | 0.78 |
| sep2026 (jun2026) | after: lesion_R1 | 0.93 | 0.91 | 0.59 | 0.79 |
| sep2026 (jun2026) | after: lesion_L1 | 0.87 | 0.81 | 0.67 | 0.55 |
| sep2026 (jun2026) | after: lesion_S8 | 0.91 | 0.89 | 0.53 | 0.89 |

Screen check (`tools/tests/compare_overlap.mjs`, Chromium, mean silhouette IoU of ghost vs current over anterior / right-lateral / superior
orthographic projections; "before" = the live viewer, "after" = this build). Screenshots: `viewer/test_shots/registration/`.
Note June -> Sep: the refined fit is slightly worse than B1 for S8 (Dice 0.81 vs 0.85) while better for liver and R1; use Lesion S8 for S8.

Follow-up (same day): Compare has a "Register earlier scan (align to current)" check box (default on). Off = the ghost in the plain
spine-anchored scanner frame relative to the current date (raw shift; May -> June liver Dice 0.85, centroid offsets R1 16.0 / L1 11.3 /
S8 20.1 mm), and the Growth map switches to `growth_sets.skeleton` (baked with the A1 pair transforms; dominated by misalignment).
An "i" popover explains the breathing problem; a plain-language glossary sits under the alignment line and in About.

## Tooltips with doctors' statements (2026-10-09)
`tools/tag_report_claims.py` adds `claims[].tags` to `report_claims.json` (called by build_viewer_data.py after the claims step; the
untagged file is kept as `viewer/data/old/report_claims.pre_tags.json`). The claims engineer's single `structure` field had 1 calcification
claim and no wall / core tags; with keywords (uk/ru/en: звапн-, кальцин-, calcif-, стінк-, wall, periph-, кіст-, некроз-, вузл-, mural,
SUV, FDG, метабол- ...) the 67 claims carry: active 26, lesion 26, size 22, liver 12, walls 9, cores 9, nodules 6, portal 6, gallbladder 4,
hepatic veins 3, calcifications 2, bile ducts 1. Stomach / technique statements get no liver tags. may_A_calcifications (no lesion id)
inherits R1 from the same sentence (may_A_rmass_size).
Objects (meshes of all dates, growth maps excluded) with at least one quote in the tooltip, own date / nearest other date / none
(lesion parts: how many have a lesion-specific quote rather than a liver-wide one):
lesions 13 / 5 / 1 of 19 (18 lesion-specific); calcifications 1 / 2 / 0 of 3 (3 specific); nodules 1 / 2 / 0 of 3 (2 specific);
walls 18 / 0 / 0 of 18 (3 specific); cores 17 / 0 / 0 of 17 (3 specific); FDG-active 9 / 0 / 0 of 9 (7 specific); liver 3 / 0 / 0;
portal 2 / 3 / 0 of 5; hepatic veins 1 / 2 / 0 of 3; gallbladder 1 / 1 / 0 of 2; IVC 0 of 3; Couinaud segments 0 of 24 (no report
statement about segments as structures).

## Performance, full detail and compact layout (2026-10-11)
**Mesh files.** The viewer now loads `data/meshes_qm/**.qm.gz` (`tools/export_qm.py`): the same vertices and triangles as the meshes,
positions quantized to 16 bits per axis (step = extent / 65535; max quantization error 0.002 mm), zig-zag delta-coded indices, gzip.
Decoded in the browser with DecompressionStream (vendored fflate 0.8.3, MIT, as fallback; no CDN). 171 full meshes: **68 MB** (the PLY set
was 277 MB). The PLY files in `data/meshes/` stay as the reference.
**Face caps removed: nothing is decimated any more.** The 17 meshes that were capped are now their uncapped builder-cache versions (same
recipe: marching cubes on the native grid, Taubin 30 with normalize_coordinates=True; voxel-back verification from the build):
| mesh | faces before (cap) → now | Dice | p95 mm |
|---|---|---|---|
| June liver | 399,998 (400k) → 756,642 | 0.9978 | 0.40 |
| May liver | 399,998 (400k) → 633,816 | 0.9979 | 0.40 |
| June R1 walls | 600,000 (600k) → 948,018 | 0.9841 | 0.31 |
| June R1 cores | 400,000 (400k) → 598,536 | 0.9960 | 0.37 |
| June segments II–VIII | 120,000 each (120k) → 132,420–268,630 | 0.9976–0.9984 | 0.30–0.34 |
| May segments III–VIII | 120,000 each (120k) → 141,986–212,238 | 0.9982–0.9989 | 0.30–0.38 |
Face cap per structure is now 4,000,000 (= none) for every structure; all meshes pass Dice ≥ 0.98.
**Progressive loading.** Light preview meshes (`tools/build_lod.py`: quadric decimation to ~20 %; p95 distance to the full surface
0.01–0.17 mm, median 0.06 mm; dropped single-voxel islands of 14–50 vertices are the only larger deviations) are fetched first for a fast
first frame; the full-detail meshes stream right after and replace each preview as it arrives. At rest the viewer always shows full detail.
FDG-active tissue, nodules and calcifications have no preview (always full). Previews are used while dragging only if 'Smooth orbit'
is on (Options; switched on automatically only when the full scene renders slower than 30 fps on the device; full detail returns 120 ms
after the camera stops).
**Rendering.** Device-pixel-ratio cap 1.5 (embed 1.25; was 2), render on demand (unchanged), no GPU picking while the camera moves, near
plane 10 mm (was 1; 10x depth precision), fixed draw order for every transparent object, depth-only pre-pass for translucent tubes and
parts, polygon offset where surfaces touch.

**Measurements** (headless Chromium, 900×620; GPU = Apple M3 Max/Metal, sw = SwiftShader CPU renderer as a weak-GPU proxy;
"before" = the live viewer of 2026-10-10):
| date, mode | first frame s | MB to first frame | MB total (full detail) | triangles drawn | sw ms/frame (orbit) |
|---|---|---|---|---|---|
| June, before (full) | 0.34 | 30.6 | 30.6 (capped) | 2.28 M | 744 |
| June, after (full) | 0.22 | 4.1 | 11.0 (uncapped) | 3.30 M | 313 (smooth orbit) |
| June, after (embed) | 0.18 | 3.6 | 9.3 | 2.55 M | 224 (smooth orbit) |
| Sep, before (full) | 0.24 | 14.8 | 14.8 | 1.02 M | 316 |
| Sep, after (full) | 0.20 | 3.4 | 5.2 | 1.16 M | 194 |
| Sep, after (embed) | 0.19 | 3.2 | 4.8 | 0.98 M | 150 |
| May, before (full) | 0.32 | 26.8 | 26.8 | 1.98 M | — |
| May, after (full) | 0.20 | 3.7 | 9.5 | 2.62 M | — |
On the M3 Max every variant runs at the 60 fps vsync cap (render 3–7 ms). The JS heap stays 20–55 MB.
**Blinking veins.** Cause: transparent meshes of the same class (portal / hepatic veins / IVC, lesions, the Compare ghosts) had equal
render order, so three.js re-sorted them by distance every frame and overlapping layers swapped as the camera turned. Measured over a
360° orbit at three elevations (540 views, Compare on): the transparent draw order changed in **539** views before, **0** after (June and Sep).
Per-pixel blink counts are dominated by edge aliasing of thin vessels and did not separate the builds.
**Layout.** The side panel starts collapsed behind 'Layers & lesions' (remembered; opens itself for a report claim, a lesion row or a
#tab= link); one row of controls on desktop; rarely used controls under 'Options'; Volumes legend collapsed to a chip; one bottom-right
toolbar. Embed (`?embed=1`): dates, Compare, EN/УКР, Options (alignment, registration check box, glossary, growth map, cut, screenshot,
link, reset), 'Open full screen'; the panel is an overlay drawer with a short layer list (Liver, R1, L1, S8, Active tissue (PET),
Cores / walls) and 'More layers'; default layers liver + R1 + L1 + S8 + FDG-active tissue.

**Volumes column (2026-10-11).** Open by default (closed on phones; state remembered), docked on the right edge of the canvas, short names (R1, L1, Liver, Active (FDG) ...; full name and confidence text in the tooltip, ⚠ marks a confidence note). The default camera framing leaves room for it: at 1440x900, 1024x700 and the 900x620 embed the liver box does not overlap it.

**Zoom (2026-10-11).** Wheel: exponential, proportional to the normalised delta (a 100-px notch = 10 %, was a fixed 5 % per event), toward the point under the pointer, eased over 120 ms (folded into the next event when wheeling fast). Trackpad pinch (ctrl+wheel): own gain (5 % per 10 units, was 0.6 %). Touch: one finger orbit, two fingers pinch + pan (OrbitControls), double tap = 2x toward the tap (or reset when already close); Safari gesture events blocked inside the canvas. Distance 15 mm - 4 m; near plane = 5 % of the distance (0.5-10 mm). Embed: the wheel scrolls the page until the model is clicked or hovered for 300 ms (one-time hint); ctrl+wheel always zooms. +/- buttons in the toolbar. Input-to-camera latency: ~1-2 ms Chromium, one frame (~16 ms) WebKit, before and after; zoom-to-cursor drift 0 px.

**Caching and the loading screen (2026-10-11).** index.html carries an inline loader: the progress bar is painted from the first bytes (stages: viewer code -> liver 3D -> preparing scene; real byte progress, a shimmer otherwise), it fetches `version.json` with cache "no-store" and loads the CSS/JS with `?v=<build>`; every relative ES-module import carries the same stamp, and a cached older index.html reloads itself once (markup hash). The app UI stays hidden until the first full frame. Run `python3 tools/stamp_version.py <viewer dir> [--site-index <site index.html>]` before every publish (it also stamps the main page embed iframes). Simulated with a Pages-like server (Cache-Control max-age=600): after changing CSS and JS on the server, a normal reload showed the old code and CSS with the previous index.html, and the new ones with the loader; a stale cached index.html reloaded to the new markup.

## Semantic colour palette (2026-10-11; tools/palette/)
Hue tells the kind of tissue: **Anatomy** muted (liver #b9a596, gallbladder olive, bile ducts green-yellow); **Tumour** one violet–magenta
family separated by lightness (N #3f2f52 · R1 #6a2f99 · S7sat #8a2c74 · L1 #a8358a · K #8f82c2 · P7 #d35bb0 · S8 #b996f2 · S1 #f3d4f6;
walls #c7a3d8 = solid tumour tissue); **Activity** the only hot colours, emissive (FDG-active #ffc400, PET-defined only #ffe680, inferred
#ff8c1a); **cores** pale ice #c3d7e4 (fluid); calcifications ivory #fff8e6; nodules lime #5a9400; **Vessels** by convention (portal #3f7ae8,
IVC #16285a, hepatic veins teal #2aa8b5, hepatic artery red #d63a3a if ever shown, L1–portal contact light blue); Couinaud segments soft
pastels; the Compare ghost neutral grey-blue. **Growth maps** now blue (shrank) – grey (0) – magenta (grew), never hot; the baked colours in
the QM files were re-mapped exactly (inverse of the old blue-white-red ramp). Layers panel has a colour key grouped by meaning; the Volumes
column is grouped the same way.
**CVD check** (`tools/palette/report.py`; CIEDE2000, minimum over opaque and 50 % over the liver; Machado 2009 deuteranopia/protanopia;
see `tools/palette/report.txt`): S8 vs FDG-active 20.0 / 14.2 (normal / worse CVD) → 44.4 / 38.9; P7 vs active 10.0 / 6.7 → 45.8 / 30.5;
L1 vs active 19.1 / 7.4 → 47.7 / 33.4; FDG-active vs every other layer: min 10.0 / 6.7 → 19.8 / 10.1 (closest: nodules). Trade-off of the
semantic scheme: lesions of one family are closer to each other (R1–L1 8.8 / 5.5, L1–S8 15.2 / 13.1, R1–S8 16.1 / 15.3) – they sit far
apart and carry ID chips; P7 vs hepatic veins and S1 vs cores stay low under CVD (1.9) – small structures in different places.

## Smoother surfaces (mesh recipe v2, 2026-10-11)
**Diagnosis of "coarser than before".** Not the normals: the PLY and QM paths both draw indexed geometry with smooth, area-weighted
vertex normals (no flat shading), and the light previews are always replaced (0 previews on screen at rest). The terraces come from the
mesh recipe itself: v1 (x3 linear interpolation between the 2-3.3 mm slices, marching cubes, Taubin 30 / pass band 0.1) keeps the slice
steps; the face caps made them worse on the published liver (decimation raised the terrace measure from 0.022 to 0.042), and the
previous viewer changes made them more visible: matte material (roughness 0.62 -> 0.92), pixel ratio 2 -> 1.5, thinner liver shell.
**Fix.** Recipe v2 (`build_viewer_data.mesh_smooth`): Gaussian on the x3-upsampled mask with sigma = k_xy x in-plane spacing and k_z x
slice spacing, marching cubes at 0.5, Taubin (normalize_coordinates=True). Per mask the strongest level that passes **Dice >= 0.98,
|volume change| < 1 % and p95 distance to the voxel boundary <= 0.7 in-plane voxel**: S3 (k_xy 0.9, k_z 1.1, Taubin 20) -> S2 (0.75 / 0.9,
Taubin 20) -> v1 (unchanged recipe). Result: large organs and lesions get S3/S2 (liver all dates S3; R1 S3/S2; L1, S8 S2/S3; segments
mostly S2/S3); thin vessels, small foci, nodules, calcifications and FDG-active tissue keep v1 automatically (smoothing would erode them).
All meshes pass (min Dice 0.9838, portal June, v1); every v2 mesh |volume change| < 1 %. Material back to roughness 0.62, pixel ratio up to
2 (1.25 on slow GPUs). LOD previews and QM files regenerated from the v2 meshes.
Terrace measure (mean |vertex-normal z minus its 1-ring mean|; lower = smoother), previously published -> now:
| mesh | before | now | level | Dice | volume ratio | p95 mm |
|---|---|---|---|---|---|---|
| June liver | 0.0418 (capped) | 0.0091 | S3 | 0.9969 | 0.9958 | 0.50 |
| May liver | 0.0353 (capped) | 0.0091 | S3 | 0.9969 | 0.9957 | 0.50 |
| Sep liver | 0.0206 | 0.0090 | S3 | 0.9961 | 0.9946 | 0.80 |
| June R1 | 0.0211 | 0.0088 | S3 | 0.9973 | 0.9957 | 0.46 |
| May R1 | 0.0319 | 0.0151 | S2 | 0.9962 | 0.9956 | 0.53 |
| Sep R1 | 0.0176 | 0.0078 | S3 | 0.9971 | 0.9951 | 0.71 |
| June L1 | 0.0253 | 0.0149 | S2 | 0.9954 | 0.9938 | 0.43 |
| June S8 | 0.0223 | 0.0093 | S3 | 0.9962 | 0.9926 | 0.45 |
| June portal / hepatic veins / IVC | 0.0436 / 0.0347 / 0.0197 | unchanged | v1 | 0.9838 / 0.9909 / 0.9956 | ~1.00 | 0.29-0.34 |

## All layers on by default (2026-10-11)
Every layer is visible by default (embed and full screen): small lesions, cores, walls, nodules, calcifications, hepatic artery where
present, Couinaud segments (faint pastel shells at 0.08, drawn before every other translucent layer, no depth write), the uncertain band
and the inferred activity; liver shell 0.18, lesion shells 0.45, walls 0.3, cores 0.5, vessels / nodules / calcifications / FDG-active
tissue solid. 'Clean view' (Layers panel) = liver + R1 / L1 / S8 + FDG-active tissue + vessels (the previous default).
Cost (June, all layers, full detail): 34 MB and 11.3 M triangles per frame (clean view ~11 MB); render 6 ms on the M3 Max test GPU; slow GPUs
get 'Smooth orbit' and pixel ratio 1.25 automatically.

## Stomach and gastric wall formation (2026-10-11)
From `consensus_gastric/<date>/` (single reader, not adjudicated; see `consensus_gastric/report.md`): layer **Stomach (organ)** (neutral warm
grey #a39a8c, 0.25) and lesion **GF – Gastric wall formation (mass)** (tumour family, dark wine #7c1d5c), group 'Stomach'. Same mesh recipe
(v2 ladder; GF S2/S3, stomach as selected), voxel-back verification: GF Dice 0.9949 / 0.9970 / 0.9968, stomach 0.9898 / 0.9909 / 0.9966
(May / June / Sep). Volumes: GF 29.6 / 27.4 / 36.5 mL (Sep upper half not separable from the pancreatic tail on the non-contrast CT,
+-25 %); stomach 210.6 / 243.2 / 223.5 mL. Placed with the same per-date transforms as the liver; the stomach does not move with the liver
(GF centroid offset June -> Sep 18 mm in the liver alignment), so its growth maps mostly show misalignment. The four report statements about
the gastric mass (May A, June A, Israeli revision, Sep) are now tagged to GF and the stomach layer (they were kept off the liver objects);
all four size statements agree with the model within 15 %.

**R1 visibility (2026-10-11).** R1 #5f22ad (darker, more saturated; contrast 7.7:1 against the light stage, 3.8:1 against the liver colour) and #7f3fd4 in the dark theme (3.5:1 against the black stage; a dark violet cannot reach 3:1 against both black and the liver); R1 shell opacity 0.55. The main cause of the "lost" mass was a bug: the depth pre-pass added against blinking also ran for walls and cores, whose outer surface coincides with the lesion surface, and hid the lesion shell whenever walls were shown (all-layers default); the pre-pass is now limited to vessels. CIEDE2000 R1 vs L1 / S8 / S1 / walls / liver (normal, worse CVD; min over opaque and over-liver): see tools/palette/report.txt.

**Activity never hidden (2026-10-11).** FDG-active tissue (all three layers), nodules and calcifications get an X-ray pass: drawn normally and again after every translucent layer, without depth test, at 0.6 opacity in their own colour (clipping planes respected). R1 shell back to 0.38 with a fresnel rim (darker, more opaque edge) for presence. Walls are drawn 0.4 mm inward so their outer surface (= the lesion surface) no longer stacks its slice terraces on the R1 shell; the R1 walls and cores themselves stay on the v1 recipe because the smoothing ladder fails the fidelity gates for them (walls Dice 0.40-0.85, cores p95 1.0-1.4 mm). Hot pixels of the FDG-active tissue visible in the full scene (light theme): June R1 close-up 0.54 -> 0.98, June default 0.59 -> 0.99, Sep default 0.32 -> 0.96.


## Stomach group registered separately (2026-10-11)
The stomach and the gastric wall formation move independently of the liver (breathing, gastric filling). `registration_refine.py --stage
stomach`: rigid fit of the stomach masks (from the liver-mask-fit pair matrix) and of the GF masks (centroid start; translation, a rotation
only if it gains >= 0.01 Dice within 10 degrees: the fits chose translation for all three pairs). In every liver-based Align mode the
stomach organ uses its stomach fit and GF its own fit (scene `registration.groups`, `group_matrix`, `group_pair_matrix`, `group_quality`);
new Align mode 'Gastric formation (GF)' anchors the whole scene on GF; Spine-anchored and 'Register earlier scan' off keep the raw scanner
frame. The status line and Compare legend show the stomach Dice and the GF centroid offset and say that stomach and liver are registered
separately (their relative position across dates is not preserved). GF growth maps use the GF fit. Rigid: volumes unchanged.
| pair | stomach (liver fit → stomach fit) | GF (liver fit → GF fit) |
|---|---|---|
| may2025 → jun2026 | stomach Dice 0.60 → 0.73, centroid 10.9 → 7.1 mm, surface 7.5 → 4.1 mm | GF Dice 0.83 → 0.85, centroid 1.1 → 1.2 mm, surface 2.0 → 1.8 mm (translation) |
| jun2026 → sep2026 | stomach Dice 0.71 → 0.77, centroid 6.2 → 5.3 mm, surface 4.9 → 4.2 mm | GF Dice 0.24 → 0.79, centroid 19.4 → 1.3 mm, surface 8.2 → 2.2 mm (translation) |
| may2025 → sep2026 | stomach Dice 0.61 → 0.68, centroid 6.2 → 3.8 mm, surface 8.9 → 5.5 mm | GF Dice 0.16 → 0.82, centroid 24.5 → 1.8 mm, surface 10.3 → 1.9 mm (translation) |
