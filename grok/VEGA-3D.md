# VEGA-3D Grok Summary

> **Repository**: https://github.com/H-EmbodVis/VEGA-3D
> **Paper**: arXiv:2603.19235
> **License**: Apache 2.0

## What It Does

VEGA-3D (**V**ideo **E**xtracted **G**enerative **A**wareness) enhances Multimodal Large Language Models (MLLMs) with 3D spatial reasoning by repurposing pre-trained video diffusion models as "latent world simulators." The core insight: video generation models trained on massive video corpora implicitly learn 3D spatial priors, even without explicit 3D supervision.

### The Problem
MLLMs like LLaVA excel at semantic understanding ("what is this?") but suffer from **spatial blindness** ("where is it?" / "how far apart are these objects?"). Traditional solutions require expensive 3D annotations or specialized 3D encoders.

### The Solution
Instead of adding 3D supervision, VEGA-3D extracts spatiotemporal features from intermediate noise levels in video diffusion models and fuses them with semantic representations via **token-level adaptive gated fusion**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Input Frames                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
┌───────────────────┐     ┌────────────────────────────┐
│  Semantic Encoder │     │  Generative Encoder        │
│  (SigLIP)         │     │  (WAN/SD/SVD/VGGT/etc.)   │
│                   │     │                            │
│  features_2d      │     │  features_gen              │
│  [B, N, D]        │     │  [B, N, D]                 │
└─────────┬─────────┘     └─────────────┬──────────────┘
          │                             │
          └─────────────┬───────────────┘
                        ▼
          ┌─────────────────────────────┐
          │    Feature Fusion Module    │
          │  (token_gated / gated /     │
          │   cross_attention / etc.)   │
          └─────────────┬───────────────┘
                        ▼
          ┌─────────────────────────────┐
          │    Multimodal Projector     │
          └─────────────┬───────────────┘
                        ▼
          ┌─────────────────────────────┐
          │    Language Model           │
          │    (Qwen2-7B)               │
          └─────────────────────────────┘
```

---

## Key Components

### 1. Base Model: LLaVA-Video-7B-Qwen2
The foundation MLLM that handles text generation. Located in `llava/model/language_model/`.

### 2. Semantic Encoder: SigLIP
Standard vision encoder (`google/siglip-so400m-patch14-384`) producing semantic features.
Path: `llava/model/multimodal_encoder/`

### 3. Generative Encoders (The Novel Part)
Located in `llava/model/multimodal_generative_encoder/`. Multiple supported backbones:

| Encoder | File | Description |
|---------|------|-------------|
| **WAN-T2V** | `wan_t2v_encoder.py` | Alibaba's WAN text-to-video model (1.3B) |
| **WAN-VACE** | `wan_vace_encoder.py` | WAN Video Any-Condition Encoder |
| **SD 2.1** | `sd21_online_encoder.py` | Stable Diffusion 2.1 |
| **SVD** | `svd_online_encoder.py` | Stable Video Diffusion |
| **VGGT** | `vggt_online_encoder.py` | Visual Geometry Grounded Transformer |
| **V-JEPA** | `vjepa_online_encoder.py` | Meta's video self-supervised model |
| **DINOv3** | `dinov3_online_encoder.py` | DINOv2 variant |
| **VAE** | `vae_online_encoder.py` | Simple VAE baseline |

**Online vs Offline**:
- **Online**: Forward pass through diffusion model at a specific timestep during training
- **Offline**: Pre-extract features; lower compute at training time

### 4. Feature Fusion Module
Path: `llava/model/feature_fusion.py`

The `FeatureFusionModule` combines semantic (`features_2d`) and generative (`features_gen`) features. Supported methods:

| Method | Formula | Trainable Params |
|--------|---------|------------------|
| `add` | `f_2d + f_gen` | None |
| `concat` | `proj(cat(f_2d, f_gen))` | projection layer |
| `weighted` | `w_2d·f_2d + w_gen·f_gen` | two scalars |
| `gated` | `g·f_2d + (1-g)·f_gen` where `g = σ(proj(cat))` | gate projection |
| `token_gated` | Same but gate is per-token (scalar per position) | gate projection |
| `cross_attention` | Cross-attn with 2D sincos positional encoding | attn + MLP blocks |
| `instruction_token_gated` | Token-gated + instruction context modulation | gate + context proj |

The **token_gated** approach is the paper's contribution: each spatial token independently decides how much to weight semantic vs generative features.

---

## Training Pipeline

### Training Scripts
Located in `scripts/3d/train/`:

```bash
# Baseline (no generative features)
scripts/3d/train/train_baseline.sh

# With different generative encoders
scripts/3d/train/train_wan_t2v_online.sh      # WAN-T2V (main config)
scripts/3d/train/train_wan_vace_online.sh     # WAN-VACE
scripts/3d/train/train_sd21_online.sh         # Stable Diffusion 2.1
scripts/3d/train/train_svd_online.sh          # Stable Video Diffusion
scripts/3d/train/train_vggt_online.sh         # VGGT
scripts/3d/train/train_vjepa_online.sh        # V-JEPA
```

### DeepSpeed Configs
`scripts/zero2.json`, `zero3.json`, etc. — standard ZeRO optimization configs.

### TRL Integration
The `trl/` directory contains training infrastructure (not HuggingFace TRL, but a custom fork). Key files:
- `trl/trainer/` — custom trainer implementations
- `trl/models/` — model wrappers

---

## Evaluation Tasks

Five 3D scene understanding benchmarks:

| Task | Script | Description |
|------|--------|-------------|
| **ScanRefer** | `eval_scanrefer.sh` | 3D object localization from text |
| **Multi3DRefer** | `eval_multi3drefer.sh` | Multi-object 3D referring |
| **Scan2Cap** | `eval_scan2cap.sh` | 3D dense captioning |
| **ScanQA** | `eval_scanqa.sh` | 3D question answering |
| **SQA3D** | `eval_sqa3d.sh` | Situated 3D QA |

Unified eval pattern:
```bash
bash scripts/3d/eval/eval_<task>.sh <run_name> uniform 32 <model_id>
```

---

## Data Organization

Expected under `data/`:
```
data/
├── benchmark/          # Evaluation datasets
├── embodiedscan/       # EmbodiedScan dataset
├── mask/               # Segmentation masks
├── metadata/           # Dataset metadata
├── models/             # Pretrained checkpoints
│   ├── siglip/
│   ├── wan-t2v-1.3b/
│   ├── stable-diffusion-2-1/
│   └── ...
├── processed/          # Preprocessed features
└── scannet/            # ScanNet dataset
```

---

## Key Implementation Details

### WAN-T2V Encoder Flow (`wan_t2v_encoder.py`)

1. **Input**: RGB frames `[N, 3, H, W]`
2. **Preprocessing**: Resize/crop to WAN resolution, normalize to `[-1, 1]`
3. **VAE Encoding**: Compress frames to latent space
4. **Noise Addition**: Add Gaussian noise at target timestep τ
5. **DiT Forward**: Run diffusion transformer, extract intermediate features
6. **Feature Extraction**: Take hidden states from specified block index
7. **Output**: Features `[N, Cg, 14, 14]`

Key hyperparams:
- `timestep`: Which diffusion timestep to extract from (default: 300)
- `shift`: Flow-matching schedule shift parameter
- `feat_block_idx`: Which transformer block to extract features from

### Feature Fusion Forward Pass

```python
def forward(features_2d, features_gen, instruction_ctx=None):
    # features_2d: [B, N, D] from SigLIP
    # features_gen: [B, N, D] from generative encoder

    if method == "token_gated":
        f2d = self.norm1(features_2d)
        fgen = self.norm2(features_gen)
        gate = sigmoid(self.gate_projection(cat([f2d, fgen], dim=-1)))
        return gate * f2d + (1 - gate) * fgen
```

---

## Dependencies

Core requirements (from `pyproject.toml`):
- Python ≥3.8 (recommended 3.10)
- PyTorch 2.4.0 + CUDA 12.1
- `transformers==4.40.0`
- `diffusers==0.30.3`
- `flash-attn==2.7.4.post1`
- `deepspeed==0.14.5`
- `peft==0.13.2`

---

## Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/H-EmbodVis/VEGA-3D.git
cd VEGA-3D
conda create -n vega3d python=3.10
conda activate vega3d
pip install -e ".[train]"

# 2. Download models
# - LLaVA-Video-7B-Qwen2
# - SigLIP
# - WAN-T2V-1.3B (or other generative encoder)
# Place in data/models/

# 3. Prepare data following Video-3D-LLM structure

# 4. Train
bash scripts/3d/train/train_wan_t2v_online.sh

# 5. Evaluate
bash scripts/3d/eval/eval_scanrefer.sh my_run uniform 32 0
```

---

## Why This Matters

1. **No 3D Supervision**: Unlike methods requiring depth sensors or 3D annotations, VEGA-3D leverages implicit priors from video models trained on internet videos.

2. **Plug-and-Play**: The generative encoder is modular; can swap between WAN, SD, SVD, etc.

3. **Emergent 3D Understanding**: Video diffusion models, despite never seeing explicit 3D data, learn to represent spatial relationships for realistic video generation — this work shows those representations transfer to 3D reasoning tasks.

4. **Token-Level Fusion**: Rather than global mixing, each spatial token independently learns to balance semantic vs. generative features, allowing fine-grained spatial reasoning.
