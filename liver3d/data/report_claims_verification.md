# Report claims - verification log

Generated 2026-10-08T16:42:00+00:00 by `viewer/report_sources/build_report_claims.py`. Output: `viewer/data/report_claims_raw.json` (67 claims, 10 contradictions).

## Method

- Each `quote_orig` must occur verbatim in the original-language source text below; the only normalisation is joining line breaks (any whitespace run = one space). Characters are compared exactly (Cyrillic `х` vs Latin `x` vs `×`, en dash, Latin `y` in "ураженyях" etc.).
- Each `highlight` must be a substring of `quote_orig` or `quote_en`.
- `quote_en` is my gloss; it is compared with the hosted English translation where one exists (informational: a mismatch only means the wording differs).
- Hosted file paths in `source` were checked to exist under the case-site folder. The hosted original PDFs are byte-identical (md5) to the sources used: May primary 9a5669e2..., May LISOD 2e029f10..., June primary ada90311..., June LISOD ed0e7ac4... .

## Source texts

- `may_A` (Primary report (Feofaniya: Kmetiuk, Ashykhmin), 13.05.2025, rank 3): `/Users/egorbeliaev/Documents/med/imaging_work/liver3d/viewer/report_sources/may2025_primary_feofaniya_uk.txt`
- `may_B` (LISOD reread (Dr. Novikov), 19.05.2025, rank 2): `/Users/egorbeliaev/Documents/med/imaging_work/liver3d/viewer/report_sources/may2025_lisod_novikov_uk.txt`
- `jun_A` (Primary report (Feofaniya: Zakrzhevska, Kmetiuk), 19.06.2026, rank 3): `/Users/egorbeliaev/Documents/med/imaging_work/liver3d/viewer/report_sources/jun2026_primary_feofaniya_uk.txt`
- `jun_B` (LISOD reread (Dr. Novikov), 08.07.2026, rank 2): `/Users/egorbeliaev/Documents/med/imaging_work/liver3d/viewer/report_sources/jun2026_lisod_novikov_uk.txt`
- `jun_C` (Israeli revision (Dr. Kulikova), 08.09.2026, rank 1): `/Users/egorbeliaev/Documents/med/imaging_work/liver3d/viewer/report_sources/jun2026_israeli_kulikova_ru.txt`
- `sep_K` (KMKOC primary report (Dr. Kholodna), 23.09.2026, rank 3): `/Users/egorbeliaev/Documents/med/imaging_work/liver3d/viewer/report_sources/sep2026_kmkoc_scan_transcription_uk.txt`
- `fed` (Surgeon (verbal): Dr Denys Fedorov, video consultation 18.09.2026, rank 4): `/Users/egorbeliaev/Documents/med/Fedorov_18_09.txt`

Source text extraction: PDFs with `pdftotext` per page (text layer of the original PDFs, not OCR); docx with macOS `textutil`; the Sep KMKOC quotes are checked against an eye transcription of the scanned original (`sep2026_kmkoc_scan_transcription_uk.txt`, pages 2-3 read at 200 dpi), because the hosted transcription differs from the scan; the Fedorov quotes are checked against the automatic speech transcript `Fedorov_18_09.txt` (not hosted) and the English quotes against the hosted English transcript.

## Per-claim result

| claim | source | quote_orig found | page | bad highlights | quote_en = hosted translation | Sep: in docx transcription |
|---|---|---|---|---|---|---|
| may_A_ref_suv | may_A | yes | 1 | - | - | - |
| may_A_no_comparator | may_A | yes | 1 | - | - | - |
| may_A_s8_size | may_A | yes | 1 | - | - | - |
| may_A_rmass_size | may_A | yes | 1 | - | - | - |
| may_A_calcifications | may_A | yes | 1 | - | - | - |
| may_A_activity | may_A | yes | 1 | - | - | - |
| may_A_cardia_formation | may_A | yes | 1 | - | - | - |
| may_B_overall | may_B | yes | 2 | - | - | - |
| may_B_rmass_change | may_B | yes | 2 | - | - | - |
| may_B_activity | may_B | yes | 2 | - | - | - |
| may_B_nodule_s8 | may_B | yes | 2 | - | - | - |
| may_B_no_new | may_B | yes | 2 | - | - | - |
| may_B_nodule_conclusion | may_B | yes | 2 | - | - | - |
| jun_A_technique | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_ref_suv | jun_A | yes | 1 | - | yes | - |
| jun_A_liver_cc | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_lesions_stable | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_rmass_size | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_s7sat | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_s8_subcapsular | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_s58 | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_s4a7 | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_llesion_size | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_llesion_portal | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_s1 | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_s4b | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_gallbladder | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_gastric | jun_A | yes | 1 | - | no (own gloss) | - |
| jun_A_conclusion | jun_A | yes | 2 | - | no (own gloss) | - |
| jun_A_caveat | jun_A | yes | 2 | - | no (own gloss) | - |
| jun_B_sizes_stable | jun_B | yes | 2 | - | no (own gloss) | - |
| jun_B_mural_enhancing | jun_B | yes | 2 | - | no (own gloss) | - |
| jun_B_activity | jun_B | yes | 2 | - | no (own gloss) | - |
| jun_B_llesion_suv | jun_B | yes | 2 | - | no (own gloss) | - |
| jun_B_no_new | jun_B | yes | 2 | - | no (own gloss) | - |
| jun_B_ducts_vessels | jun_B | yes | 2 | - | no (own gloss) | - |
| jun_B_conclusion | jun_B | yes | 2 | - | no (own gloss) | - |
| jun_C_technique | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_known_lesions | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_rmass_activity | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_rmass_size | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_rmass_change | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_llesion_size | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_llesion_change | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_llesion_activity | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_ducts_portal | jun_C | yes | - | - | yes | - |
| jun_C_gallbladder | jun_C | yes | - | - | yes | - |
| jun_C_adrenal | jun_C | yes | - | - | yes | - |
| jun_C_gastric | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_conclusion_activity | jun_C | yes | - | - | no (own gloss) | - |
| jun_C_conclusion_rmass | jun_C | yes | - | - | yes | - |
| fed_llesion_between_veins | fed | yes | - | - | no (own gloss) | - |
| fed_llesion_lhv | fed | yes | - | - | yes | - |
| fed_llesion_lpv | fed | yes | - | - | yes | - |
| fed_llesion_s3_branches | fed | yes | - | - | no (own gloss) | - |
| fed_s1_not_left | fed | yes | - | - | no (own gloss) | - |
| fed_dark_on_ct | fed | yes | - | - | yes | - |
| fed_rmass_volume | fed | yes | - | - | no (own gloss) | - |
| sep_K_ref_suv | sep_K | yes | 2 | - | no (own gloss) | yes |
| sep_K_known_lesions | sep_K | yes | 2 | - | yes | yes |
| sep_K_rmass_size | sep_K | yes | 2 | - | no (own gloss) | yes |
| sep_K_rmass_change | sep_K | yes | 2 | - | no (own gloss) | yes |
| sep_K_activity | sep_K | yes | 2 | - | no (own gloss) | no |
| sep_K_llesion_active | sep_K | yes | 2 | - | no (own gloss) | no |
| sep_K_s8_active | sep_K | yes | 2 | - | no (own gloss) | yes |
| sep_K_gastric | sep_K | yes | 2 | - | no (own gloss) | no |
| sep_K_conclusion | sep_K | yes | 3 | - | yes | yes |

## Result: 67/67 claims verified; 0 failures.

## Findings while verifying

- **Sep KMKOC: the hosted transcription differs from the scanned original.** Scan page 2: "в структурі деяких, високої інтенсивності SUVmax= до 4,9" (of HIGH intensity); hosted docx transcription and English translation: "в структурі деяких з них, інтенсивності SUVmax= до 4,9" (no "high"). Minor spacing differences too ("утвори(найбільший", "35x54мм(зливного", "FDG- негативне", "43x32мм(раніше"). The claims quote the scan. guidance/sep2026.md quotes the docx wording.
- **Sep KMKOC "раніше 14,4x10,4мм"**: millimetres in the scanned original itself (meant cm, = June primary 14.4 x 10.4 cm).
- **June primary conclusion "від 13.05.2026"**: wrong year (body: 13.05.2025).
- **May LISOD conclusion "Порівняно із 03/2025"**: comparators listed are 14.03.2024 and 17.08.2023; no March 2025 scan.
- **June LISOD**: "помріно" (= помірно), "ураженyях" with a Latin y, "по вузлу 42" (probably the ~42 mm left-lobe lesion).
- **June primary "на межі Sg4а/7"**: segments IVa and VII are not adjacent (Cyrillic "а" in the original).
- **Israeli revision technique line** ("без внутривенного ... контрастного вещества") conflicts with the venous-phase contrast CT in the DICOM.
- **The May 2025 report pages** (reports/2025_2026_imaging_63ba8b0c...html, reports/2025_2026_imaging_69963...html) exist and carry the Ukrainian text but are not linked from documents.html; documents.html rows [67]/[68] link the PDFs, the orig/ pages and Drive.
- **Fedorov full transcript page** is marked "intentionally unlinked ... share the URL only with clinicians"; the claims link it as report_page. The Ukrainian original of the call (Fedorov_18_09.txt, automatic speech transcript) is local only; its quotes carry speech-recognition errors ("сегелієвої" = спігелієвої, "гіпервоскулярна", "займáв").
- **Guidance quote check** (every Cyrillic quote in guidance/*.md against the same source texts): 3 small non-verbatim quotes, none changes meaning - may2025.md "Sg7/8 субкапсулярно 6,3х4,3 см" (source: "Sg7/8 субкапсулярно розміром до 6,3х4,3 см"); jun2026.md "вузол 42" (source: "по вузлу 42"); sep2026.md "37x47мм(4,6x3,7см)" (pelvis, not liver; docx has a space before the bracket).
- **Mapping uncertainties** (confidence "ambiguous"): May "SVIII / SIV 6.2 x 4.0 cm" and June "Sg7/8 subcapsular 6.3 x 4.3 cm" -> S8 by size, not stated by the reports; the May 11 mm nodule -> S8 (body text) and R1 (conclusion); Sep "15 x 24 mm in S8" -> S8 (could be the superior wall of R1); June LISOD mural elements -> R1 ("in particular" the largest; others unnamed); surgeon's "segment I" lesion -> S1 (which lesion he meant is unclear).

