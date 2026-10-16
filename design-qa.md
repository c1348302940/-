# 团队进度 Design QA

## 对照信息

- Source visual truth (2D): `C:\Users\CHENMI~1\AppData\Local\Temp\codex-clipboard-c6cbd2f8-39c3-48f8-bac0-00ba5e1537be.png`
- Source visual truth (3D): `C:\Users\CHENMI~1\AppData\Local\Temp\codex-clipboard-d946d9ac-4c30-4971-ad24-0d6bb6685f02.png`
- Implementation (2D): `C:\Users\chenmingwang\Desktop\营销工作台\app\screenshots\team-progress-2d.png`
- Implementation (3D): `C:\Users\chenmingwang\Desktop\营销工作台\app\screenshots\team-progress-3d.png`
- Browser URL: `http://127.0.0.1:8787/`
- Test viewport: 1440 × 1000 CSS px, device scale factor 1.
- Source pixels: 2D 1061 × 638; 3D 973 × 659.
- Implementation pixels: 1440 × 1000 for both views. The comparison used the centered visualization card as the content region; browser chrome and surrounding page canvas were excluded from design judgments.
- State: 4 members × 5 version columns in the fixture; one selected member/version cell; 2D and 3D states.

## Full-view comparison evidence

The source and implementation were opened in one comparison pass. Both implementations now use the same core composition as the source: one thin outlined white card, compact identity header, scope selector and segmented 2D/3D control, three metrics with vertical separators, a centered chart, monochrome green intensity scale, selected black outline, a bottom detail row, and a final breakdown strip. The production card fills the available content width as a horizontal rectangle so it no longer leaves unused side gutters.

The fixture contains 20 member/version cells while the source contains more daily cells. The lower density is an intentional data-model difference. It does not change the visual system or interaction pattern.

## Focused region comparison evidence

- Header and metrics: checked title hierarchy, selector/control sizing, dividers, numeric weight and caption tone.
- Plot: checked square size/gaps, centered alignment, green scale, empty-cell treatment and selection border.
- 3D plot: checked building height, density, green faces, ground plane, selection outline and absence of roof text.
- Footer: checked legend placement, selected-item detail row, arrow controls and bottom divider rhythm.

## Comparison history

### Iteration 1 — blocked

- P1: The original 2D view used large business-dashboard cards containing percentages and task text. The source uses compact empty squares with details outside the plot.
- P1: The original 3D view used blue/green tall columns with percent labels and a red risk outline. The source uses restrained low-rise buildings in one green scale with no roof text.
- P1: Five separate summary cards sat above the visualization. The source integrates three metrics into the visualization card.
- P2: The original view lacked the source-like selected-item detail row and breakdown strip.

Fixes applied: rebuilt the visualization as one focused card; changed the palette to five green levels; reduced block heights; removed in-cell and roof text; added black selection outlines, integrated metrics, a compact legend, a selected member/version row, previous/next controls and task breakdown text.

### Iteration 2 — passed

- Browser fixture: 20 2D cells and 20 matching 3D blocks rendered.
- 2D cells contain no visible text; one cell has the selected outline.
- 3D blocks contain no text; one roof has the selected outline; drag updates the orbit angle.
- Live Supabase-backed page switches from 2D to 3D without console errors and keeps the same selected member/version context.

## Required fidelity surfaces

- Fonts and typography: Uses the product's existing Chinese UI font stack with source-like 11–15 px labels and 23 px metric values. Weight and hierarchy are consistent; no large decorative display type remains.
- Spacing and layout rhythm: Header, metric, plot, legend and footer regions use the source's stacked rhythm, thin dividers, compact control heights and 15 px outer radius.
- Colors and visual tokens: The chart is limited to neutral gray plus five green intensity levels. The active toggle and selected cell use near-black, matching the source's emphasis pattern.
- Image quality and asset fidelity: The component has no raster image assets. Existing product icon primitives remain sharp at browser scale; chart geometry is browser-rendered vector UI.
- Copy and content: Source focus-time labels were replaced with product-correct team completion, in-progress and overdue metrics. The layout relationship and information density remain faithful.

## Findings

No actionable P0, P1 or P2 mismatches remain.

## Follow-up polish

- P3: With only one real member and no tasks, the live chart is necessarily sparse. Adding real versions and tasks will produce the denser city visible in the fixture and reference.

## Primary interactions tested

- 2D/3D segmented switch.
- 2D cell and 3D block selection state.
- 3D horizontal drag/orbit.
- Version/member selection data preserved across render.
- Previous/next selected cell behavior covered by implementation and syntax validation.
- Browser console error check: no errors.

## Implementation checklist

- [x] Use one focused card.
- [x] Integrate three team metrics.
- [x] Render compact 2D green squares without internal text.
- [x] Render compact 3D green buildings without roof text.
- [x] Keep 2D and 3D on the same member/version matrix.
- [x] Show selected member/version detail outside the plot.
- [x] Keep task-list filtering and existing data behavior.
- [x] Verify fixture and live page.

final result: passed
