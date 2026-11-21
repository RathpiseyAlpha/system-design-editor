# Challenges

A challenge is what a host sends a learning-mode embed: a brief, a starting diagram and the rules
(`format: archboard-challenge`). Each `<id>.json` has a reference solution beside it, `<id>.solution.json`, used only by
the tests (`packages/engine/src/challenges.test.ts`): the solution must score full marks, the starting diagram less, and a
blank diagram nothing.

A host sends `brief`, `start` (as `diagram`) and `rules` into the embed, and keeps its own copy of `rules` on its server to
score what is handed in. Never send the solution to a browser. Rules sent into the embed are visible to the student: a
check that must stay secret belongs only in the server's copy.
