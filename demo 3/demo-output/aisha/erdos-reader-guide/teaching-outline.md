# One-Page Teaching Outline: The Missing One

**Topic:** A 2-adic construction showing that fast-growing moduli can leave only one uncovered integer.

**Audience:** Readers comfortable with congruences and elementary divisibility.

**Length:** 20–25 minutes.

## Learning goals

By the end, learners should be able to explain the counterexample, use \(v_2(m-1)\) to find a covering class, and distinguish the growth check from the coverage argument.

## Board plan

### 1. Pose the question (3 min)

For increasing \(n_i\), one residue class modulo each \(n_i\), count \(0\le m<n_k\) avoiding the first \(k\). Does \(n_k>(1+\varepsilon)k\log k\) force the count not to be \(o(k)\)? Define \(o(k)\) as “count divided by \(k\) tends to zero.”

### 2. Reveal the pattern (4 min)

Use \(n_i=2^i\) and \(a_i=1+2^{i-1}\). First examples:

| Class | Modulus | Representative | Catches integers with |
|---|---:|---:|---|
| 1 | 2 | 2 | \(v_2(m-1)=0\) |
| 2 | 4 | 3 | \(v_2(m-1)=1\) |
| 3 | 8 | 5 | \(v_2(m-1)=2\) |

Ask: what kind of integer avoids every class? The candidate is \(m=1\), because \(m-1=0\) has no finite 2-adic valuation.

### 3. Prove coverage (7 min)

Take \(m\ne1\) with \(0\le m<2^k\). Set \(t=v_2(m-1)\), so \(m-1=2^t u\) for odd \(u\). Explain that \(t\le k-1\), including \(m=0\), where \(m-1=-1\) and \(t=0\). Then

\[
m\equiv1+2^t=a_{t+1}\pmod{2^{t+1}}.
\]

Since \(1\le t+1\le k\), this is one of the chosen classes. Thus all tested \(m\) except 1 are covered; verify separately that 1 avoids all classes. The count is exactly 1.

### 4. Verify the growth (4 min)

For \(k\ge4\), use \(\log k<k/2\) and \(2^k\ge k^2\), giving \(2k\log k<2^k\). Check \(k=1,2,3\) directly. Therefore \(n_k=2^k>2k\log k\), which is the requested condition with \(\varepsilon=1\). Note that this is logically separate from the covering argument.

### 5. Close and check understanding (3–5 min)

Summarize: the valuation partitions all nonzero differences \(m-1\) into exact powers of 2; each level gets its own congruence class, and the zero difference at \(m=1\) is the lone survivor. Ask learners to identify the class catching \(m=13\) when \(k\ge3\): since \(13-1=12=4\cdot3\), \(t=2\), so class 3 modulo 8 catches it.

**Takeaway:** Modulus growth alone does not prevent a nested family of classes from covering all but a constant number of integers.
