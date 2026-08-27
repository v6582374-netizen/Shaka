# Unitree G1 Web asset

`g1_29dof_rev_1_0.glb` is a neutral, static exterior model generated from
Unitree Robotics' official `unitree_rl_gym` source at commit
`276801e46c5d433564f24658bac64f254b7d2d4b`.

Source: <https://github.com/unitreerobotics/unitree_rl_gym/tree/main/resources/robots/g1_description>

The source is BSD-3-Clause; its full notice is in
`UNITREE-RL-GYM-BSD-3-CLAUSE.txt`. The asset excludes `logo_link` and carries
no animation. It must be labelled as a static exterior model until a separately
verified, read-only joint-state mapping is available.

Regenerate with:

```bash
python scripts/build_g1_hologram_asset.py \
  --source-root /path/to/unitree_rl_gym \
  --output apps/operator-console/public/assets/g1/g1_29dof_rev_1_0.glb
```
