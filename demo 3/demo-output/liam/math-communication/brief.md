# Explaining advanced mathematics to mixed audiences

**Research brief · 27 September 2026**

## Five principles

1. **Choose one audience-facing takeaway.** Decide what a reader should remember before choosing detail; put that point near the start and let each section support it. MAA author Keith Devlin recommends a single takeaway for general readers; SIAM likewise advises adapting vocabulary and examples to audience background. For this material: *fast-growing moduli can still leave only one integer uncovered.* ([MAA, 29 Mar 2022](https://maa.org/math-values/writing-about-mathematics-for-a-general-audience/); [SIAM, “Communicating Mathematics to a Nontechnical Audience,” date not listed](https://www.siam.org/publications/siam-news/articles/communicating-mathematics-to-a-nontechnical-audience/))

2. **Lead with the question and stakes, then give the result.** Orient readers before notation: say what is being counted and what the growth hypothesis is meant to force. State the answer plainly before the proof. For a broad audience, a short “one survivor among a growing interval” hook gives the abstraction a concrete image; do not imply a real-world application the argument does not have. ([MAA, 2022](https://maa.org/math-values/writing-about-mathematics-for-a-general-audience/); [MIT OpenCourseWare, Spring 2013](https://ocw.mit.edu/courses/18-821-project-laboratory-in-mathematics-spring-2013/pages/presentations/))

3. **Layer intuition and rigor.** Offer a small example or verbal picture, then the exact definition and proof. Examples build intuition but do not replace a general argument; formal statements prevent the picture from being mistaken for the result. For Problem 280, show classes `2 mod 2`, `3 mod 4`, `5 mod 8`, explain that each catches a new exact power of 2 in `m − 1`, then prove the valuation argument. ([MAA MathComm, “Balancing conceptual with formal,” date not listed](https://mathcomm.org/general-principles-of-communicating-math/balancing-conceptual-with-formal/); [MIT OCW, Spring 2013](https://ocw.mit.edu/courses/18-821-project-laboratory-in-mathematics-spring-2013/pages/presentations/))

4. **Make the proof’s route visible.** Preview the proof’s jobs, signpost transitions, and explain why each step matters. This example has two independent obligations: verify `2^k > 2k log k`, then show every integer from 0 through `2^k − 1` except 1 is covered. Keeping these separate makes the logic easier to follow and audit. MIT recommends motivation and intuition alongside accuracy; the MAA communication resources explicitly emphasize structure, logical ordering, and guiding readers. ([MIT OCW, Spring 2013](https://ocw.mit.edu/courses/18-821-project-laboratory-in-mathematics-spring-2013/pages/presentations/); [MAA MathComm, general principles, date not listed](https://mathcomm.org/general-principles-of-communicating-math/))

5. **Use plain language without weakening claims; make provenance explicit.** Define necessary terms at first use, say what the symbols mean, and retain exact quantifiers and edge cases. For this proof, define `v₂(x)` as the exponent of 2 dividing nonzero `x`, and explicitly include `m = 0`, where `v₂(−1) = 0`. Distinguish an exposition or verification from the original observation or a new solution. ([SIAM, date not listed](https://www.siam.org/publications/siam-news/articles/communicating-mathematics-to-a-nontechnical-audience/); [National Academies, *Communicating Science Effectively*, 2017](https://nap.nationalacademies.org/read/23674/); repository context: [Erdős Problem 280](https://www.erdosproblems.com/280))

## Explanatory structures that work

**A short mixed-audience explanation**

1. **Hook / question:** “Can rapidly growing moduli still cover almost every integer?” Define what “covered” means in one sentence.
2. **Answer first:** Yes: choose `nᵢ = 2ⁱ` and `aᵢ = 1 + 2ⁱ⁻¹ mod 2ⁱ`; among integers `0 ≤ m < 2ᵏ`, exactly one avoids the first `k` classes.
3. **Pattern before notation:** The first classes catch numbers according to whether `m − 1` is odd, divisible by 2 but not 4, divisible by 4 but not 8, and so on. The value `m = 1` is the exception because `m − 1 = 0`.
4. **Proof map:** “We check the growth condition, then prove the coverage count.” This tells the reader why two separate arguments follow.
5. **Formal proof:** Define `t = v₂(m − 1)` for `m ≠ 1`; show `t ≤ k − 1`; derive `m ≡ 1 + 2ᵗ ≡ aₜ₊₁ (mod 2ᵗ⁺¹)`. Verify 1 avoids every class. Separately establish `2ᵏ > 2k log k`, including the small cases.
6. **Interpretation and scope:** The classes partition the interval’s residues other than 1 by the exact power of 2 dividing `m − 1`. State that this is an exposition/verification of Cambie’s counterexample recorded by Bloom, not a new resolution.

**A compact talk / slide sequence**

- **Question:** one sentence, one displayed condition, define the count.
- **Construction:** show `nᵢ, aᵢ`, then a three-row table of the first classes.
- **Mechanism:** explain “exact power of two” visually or verbally; invite the audience to test `m = 13` (caught by class 3 modulo 8).
- **Proof:** coverage first, survivor check, then growth check; pause after each claim.
- **Takeaway and attribution:** restate “exactly one survives,” then identify the source and status of the result.

## Sources and dates

- Keith Devlin, [“Writing About Mathematics for a General Audience,” Mathematical Association of America](https://maa.org/math-values/writing-about-mathematics-for-a-general-audience/), **29 March 2022**. Audience, one takeaway, hooks, story, and managing mathematical detail.
- [“Communicating Mathematics to a Nontechnical Audience,” SIAM News](https://www.siam.org/publications/siam-news/articles/communicating-mathematics-to-a-nontechnical-audience/), **publication date not listed** (accessed 27 September 2026). Audience adaptation, jargon, relevance, accuracy/brevity/clarity.
- [“Presentations,” MIT OpenCourseWare, Project Laboratory in Mathematics](https://ocw.mit.edu/courses/18-821-project-laboratory-in-mathematics-spring-2013/pages/presentations/), course **Spring 2013**. Motivation and intuition with mathematical accuracy; selective formality, examples, figures, and pacing.
- [“Balancing conceptual with formal,” MAA Mathematical Communication](https://mathcomm.org/general-principles-of-communicating-math/balancing-conceptual-with-formal/), **publication date not listed** (accessed 27 September 2026). Pair conceptual explanations/examples with exact formal statements.
- [“General principles of mathematical communication,” MAA Mathematical Communication](https://mathcomm.org/general-principles-of-communicating-math/), **publication date not listed** (accessed 27 September 2026). A resource map covering structure, audience, proof, visuals, notation, and sources.
- National Academies of Sciences, Engineering, and Medicine, [*Communicating Science Effectively: A Research Agenda*](https://nap.nationalacademies.org/read/23674/), **2017**. Evidence review; narrative can support engagement and memory, while effective choices depend on audience and communication goal.
- T. F. Bloom, [Erdős Problem 280](https://www.erdosproblems.com/280), **page date not listed** (accessed 27 September 2026). Problem record identifies Stijn Cambie’s counterexample and the construction used here.

*Scope note:* These recommendations synthesize mathematical exposition guidance and broader science-communication research; the latter informs audience and narrative choices but is not a proof-writing standard. “Best practices” here means a practical synthesis, not a claim that one format suits every audience.
