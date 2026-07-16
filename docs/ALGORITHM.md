# Algorithm notes

## Problem model

The engine receives a 10×10 observation grid with four states: unknown, miss, hit, and sunk. It also receives a rule set and, where available, explicit cell lists for sunk ships. A legal hidden configuration must satisfy every observation, fleet multiplicity, ship geometry, overlap rule, and rule-specific contact constraint.

Russian classic mode uses the fleet `[4,3,3,2,2,2,1,1,1,1]` and forbids orthogonal and diagonal contact. International mode uses `[5,4,3,3,2]` and permits contact.

## Validation and pruning

Before search, the engine:

1. validates sunk-ship shape and ownership;
2. derives remaining fleet multiplicities;
3. clusters unresolved hits orthogonally;
4. rejects impossible hit geometry under no-touch rules;
5. marks misses, sunk cells, and provably blocked neighbors;
6. precomputes legal placements by remaining ship length.

Unknown cells that occur in no compatible placement are marked impossible.

## Exact enumeration

When the estimated search tree is below `enumLimit`, depth-first search enumerates complete legal fleet configurations. Repeated ship lengths are canonicalized to prevent permutation duplicates. Occupancy counts divided by the number of configurations produce exact posterior probabilities under a uniform prior over legal configurations.

## Weighted Monte Carlo

For larger states, the engine uses Sequential Importance Sampling. At each placement step, it chooses uniformly among currently legal options and multiplies the sample weight by the number of choices. If the sequence of branching factors is $$b_1,\dots,b_k$$, the configuration weight is:

$$w(C)=\prod_{i=1}^{k} b_i$$

The weighted occupancy estimate is:

$$\hat P(x)=\frac{\sum_{j=1}^{N}w_j\mathbf{1}[x\in C_j]}{\sum_{j=1}^{N}w_j}$$

The UI reports both accepted samples and effective sample size:

$$N_{\mathrm{eff}}=\frac{\left(\sum_jw_j\right)^2}{\sum_jw_j^2}$$

A deterministic position-derived PRNG seed keeps results stable when runs complete the same sampling budget. A real-time deadline can still change the accepted sample count on slower hardware.

## Policy selection

The default target is maximum posterior occupancy. In sampled positions, close candidates can be compared with two-ply conditional lookahead. In sufficiently small enumerated endgames, bounded expectimax minimizes expected remaining shots.

Expectimax is deliberately constrained by configuration count, node count, and wall-clock budget because the decision tree grows exponentially.

## Fallback

If enumeration and sampling produce no weighted configuration within budget, a placement-density heuristic supplies relative scores. The result is marked `exact: false`; those values are weights, not calibrated probabilities.

## Assumptions and limitations

- The prior is uniform over legal hidden configurations, not over human placement habits.
- Opponent behavior does not affect the shot policy because only hidden placement is modeled.
- Monte Carlo estimates have variance; effective sample size can be much lower than accepted samples.
- International sunk ships should be supplied explicitly because touching ships can merge under flood fill.
- “Best” means best under the current model and compute budget, not universally unbeatable.
- Benchmark output depends on simulator prior, parameters, hardware, and commit.
