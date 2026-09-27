# Reader’s Guide: A Counterexample to Erdős Problem 280

## The question

Choose increasing positive moduli \(n_1<n_2<\cdots\), and for each one choose a single residue class \(a_i\pmod{n_i}\). Among the integers \(0\le m<n_k\), how many avoid all of the first \(k\) classes? The problem asks whether the growth condition

\[
n_k>(1+\varepsilon)k\log k
\]

forces this number to fail to be \(o(k)\). Here \(o(k)\) means that the number, divided by \(k\), tends to zero. The artifact answers **no**: even with exponentially growing moduli, exactly one integer can remain uncovered at every stage.

## The construction and proof strategy

Set

\[
n_i=2^i,\qquad a_i=1+2^{i-1}\pmod{2^i}.
\]

The proof has two independent checks:

1. **The moduli grow fast enough.** For \(k\ge4\), \(\log k<k/2\) and \(2^k\ge k^2\), so \(2k\log k<k^2\le2^k\). The same strict inequality holds directly for \(k=1,2,3\). Thus the condition holds with \(\varepsilon=1\).
2. **Every tested integer but one is covered.** The integer \(m=1\) avoids every class: its difference from the class representative is \(a_i-1=2^{i-1}\), which is not divisible by \(2^i\). For any other \(m\) in \([0,2^k)\), let \(t=v_2(m-1)\), the exponent of 2 in \(m-1\). Then \(t\le k-1\), and \(m-1=2^t u\) for an odd integer \(u\). Hence \(m\equiv1+2^t=a_{t+1}\pmod{2^{t+1}}\), so one of the first \(k\) classes covers it.

Therefore the uncovered count is exactly \(1\), and \(1/k\to0\), as required for an \(o(k)\) count. Equivalently, the classes sort the tested integers by the exact value of \(v_2(m-1)\): class \(i\) catches those with valuation \(i-1\), leaving only \(m=1\).

## Key definitions

- **Residue class \(a\pmod n\):** all integers whose difference from \(a\) is divisible by \(n\).
- **Avoiding a class:** not being congruent to its representative modulo its modulus.
- **\(v_2(x)\):** for nonzero integer \(x\), the largest \(t\ge0\) such that \(2^t\) divides \(x\). It applies to negative integers too; in particular \(v_2(-1)=0\).
- **Odd part:** if \(x=2^t u\) with \(u\) odd, then \(u\) is what remains after removing all powers of 2.
- **\(o(k)\):** a sequence \(b_k\) is \(o(k)\) when \(b_k/k\to0\). A constant count of one qualifies.

## Likely points of confusion

- **The interval is not a set of representatives modulo each smaller modulus chosen independently.** The count is over \(0\le m<2^k\), and each such integer is checked against all first \(k\) classes.
- **Why does the valuation choose the right class?** If \(v_2(m-1)=t\), then \(2^t\) divides \(m-1\), so \(m\equiv1+2^t\pmod{2^{t+1}}\). The odd factor ensures \(2^{t+1}\) does not divide \(m-1\), though only the congruence is needed to show coverage.
- **What about \(m=0\)?** Then \(m-1=-1\), which is nonzero and has \(v_2(-1)=0\); it is covered by class \(i=1\).
- **Why is \(t\le k-1\)?** For \(m=0\), \(t=0\). Otherwise \(1\le m-1\le2^k-2\), so the positive difference cannot be divisible by \(2^k\).
- **Why does growth not save the proposed conclusion?** Rapidly increasing moduli do not prevent carefully nested classes from covering almost the entire interval. Here one residue survives, while the interval length grows as \(2^k\).

## Scope and attribution

The artifact presents an exposition and independent verification of a counterexample already observed by Stijn Cambie and recorded by T. F. Bloom. It does not claim a new resolution. It cites Erdős and Graham’s *Old and New Problems and Results in Combinatorial Number Theory* (1980), p. 29, and [Erdős Problem 280](https://www.erdosproblems.com/280).
