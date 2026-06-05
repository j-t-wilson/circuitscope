// Example circuits for CircuitScope launch mode

export const EXAMPLE_CIRCUITS = [
  {
    id: 'bit-flip-d3',
    name: 'd=3 Bit Flip Code',
    shortName: 'd=3 Bit Flip',
    description: 'd=3 repetition code, 5 rounds, compact REPEAT form',
    circuit: `R 0 1 2 3 4
X_ERROR(0.001) 0 1 2 3 4
TICK
CX 0 1 2 3
DEPOLARIZE2(0.005) 0 1 2 3
TICK
CX 2 1 4 3
DEPOLARIZE2(0.005) 2 1 4 3
TICK
X_ERROR(0.01) 1 3
M 1 3
DETECTOR(1, 0) rec[-2]
DETECTOR(3, 0) rec[-1]
REPEAT 4 {
    TICK
    R 1 3
    X_ERROR(0.001) 1 3
    TICK
    CX 0 1 2 3
    DEPOLARIZE2(0.005) 0 1 2 3
    TICK
    CX 2 1 4 3
    DEPOLARIZE2(0.005) 2 1 4 3
    TICK
    X_ERROR(0.01) 1 3
    M 1 3
    SHIFT_COORDS(0, 1)
    DETECTOR(1, 0) rec[-2] rec[-4]
    DETECTOR(3, 0) rec[-1] rec[-3]
}
TICK
R 1 3
X_ERROR(0.001) 1 3
TICK
X_ERROR(0.01) 0 2 4
M 0 2 4
DETECTOR(1, 1) rec[-2] rec[-3] rec[-5]
DETECTOR(3, 1) rec[-1] rec[-2] rec[-4]
OBSERVABLE_INCLUDE(0) rec[-1]`
  },
  {
    id: 'phase-flip-d5',
    name: 'd=5 Phase Flip Code',
    shortName: 'd=5 Phase Flip',
    description: 'd=5 phase-flip repetition code, compact REPEAT form',
    circuit: `RX 0 2 4 6 8
TICK
R 1 3 5 7
X_ERROR(0.001) 1 3 5 7
TICK
XCX 0 1 2 3 4 5 6 7
DEPOLARIZE2(0.005) 0 1 2 3 4 5 6 7
TICK
XCX 2 1 4 3 6 5 8 7
DEPOLARIZE2(0.005) 2 1 4 3 6 5 8 7
TICK
X_ERROR(0.01) 1 3 5 7
M 1 3 5 7
DETECTOR(1, 0) rec[-4]
DETECTOR(3, 0) rec[-3]
DETECTOR(5, 0) rec[-2]
DETECTOR(7, 0) rec[-1]
REPEAT 2 {
    TICK
    R 1 3 5 7
    X_ERROR(0.001) 1 3 5 7
    TICK
    XCX 0 1 2 3 4 5 6 7
    DEPOLARIZE2(0.005) 0 1 2 3 4 5 6 7
    TICK
    XCX 2 1 4 3 6 5 8 7
    DEPOLARIZE2(0.005) 2 1 4 3 6 5 8 7
    TICK
    X_ERROR(0.01) 1 3 5 7
    M 1 3 5 7
    SHIFT_COORDS(0, 1)
    DETECTOR(1, 0) rec[-4] rec[-8]
    DETECTOR(3, 0) rec[-3] rec[-7]
    DETECTOR(5, 0) rec[-2] rec[-6]
    DETECTOR(7, 0) rec[-1] rec[-5]
}
TICK
R 1 3 5 7
X_ERROR(0.001) 1 3 5 7
TICK
H 0 2 4 6 8
TICK
X_ERROR(0.01) 0 2 4 6 8
M 0 2 4 6 8
DETECTOR(1, 1) rec[-4] rec[-5] rec[-9]
DETECTOR(3, 1) rec[-3] rec[-4] rec[-8]
DETECTOR(5, 1) rec[-2] rec[-3] rec[-7]
DETECTOR(7, 1) rec[-1] rec[-2] rec[-6]
OBSERVABLE_INCLUDE(0) rec[-1]`
  },
  {
    id: 'surface-d3',
    name: 'd=3 Surface Code',
    shortName: 'd=3 Surface',
    description: 'Rotated surface code, d=3, compact REPEAT form',
    circuit: `R 1 3 5 8 10 12 15 17 19 2 9 11 13 14 16 18 25
TICK
H 2 11 16 25
DEPOLARIZE1(0.005) 2 11 16 25
TICK
CX 2 3 16 17 11 12 15 14 10 9 19 18
DEPOLARIZE2(0.005) 2 3 16 17 11 12 15 14 10 9 19 18
TICK
CX 2 1 16 15 11 10 8 14 3 9 12 18
DEPOLARIZE2(0.005) 2 1 16 15 11 10 8 14 3 9 12 18
TICK
CX 16 10 11 5 25 19 8 9 17 18 12 13
DEPOLARIZE2(0.005) 16 10 11 5 25 19 8 9 17 18 12 13
TICK
CX 16 8 11 3 25 17 1 9 10 18 5 13
DEPOLARIZE2(0.005) 16 8 11 3 25 17 1 9 10 18 5 13
TICK
H 2 11 16 25
DEPOLARIZE1(0.005) 2 11 16 25
TICK
X_ERROR(0.01) 2 9 11 13 14 16 18 25
M 2 9 11 13 14 16 18 25
DETECTOR(0, 4, 0) rec[-4]
DETECTOR(2, 2, 0) rec[-7]
DETECTOR(4, 4, 0) rec[-2]
DETECTOR(6, 2, 0) rec[-5]
REPEAT 2 {
    TICK
    R 2 9 11 13 14 16 18 25
    TICK
    H 2 11 16 25
    DEPOLARIZE1(0.005) 2 11 16 25
    TICK
    CX 2 3 16 17 11 12 15 14 10 9 19 18
    DEPOLARIZE2(0.005) 2 3 16 17 11 12 15 14 10 9 19 18
    TICK
    CX 2 1 16 15 11 10 8 14 3 9 12 18
    DEPOLARIZE2(0.005) 2 1 16 15 11 10 8 14 3 9 12 18
    TICK
    CX 16 10 11 5 25 19 8 9 17 18 12 13
    DEPOLARIZE2(0.005) 16 10 11 5 25 19 8 9 17 18 12 13
    TICK
    CX 16 8 11 3 25 17 1 9 10 18 5 13
    DEPOLARIZE2(0.005) 16 8 11 3 25 17 1 9 10 18 5 13
    TICK
    H 2 11 16 25
    DEPOLARIZE1(0.005) 2 11 16 25
    TICK
    X_ERROR(0.01) 2 9 11 13 14 16 18 25
    M 2 9 11 13 14 16 18 25
    SHIFT_COORDS(0, 0, 1)
    DETECTOR(2, 0, 0) rec[-8] rec[-16]
    DETECTOR(2, 2, 0) rec[-7] rec[-15]
    DETECTOR(4, 2, 0) rec[-6] rec[-14]
    DETECTOR(6, 2, 0) rec[-5] rec[-13]
    DETECTOR(0, 4, 0) rec[-4] rec[-12]
    DETECTOR(2, 4, 0) rec[-3] rec[-11]
    DETECTOR(4, 4, 0) rec[-2] rec[-10]
    DETECTOR(4, 6, 0) rec[-1] rec[-9]
}
TICK
R 2 9 11 13 14 16 18 25
TICK
X_ERROR(0.01) 1 3 5 8 10 12 15 17 19
M 1 3 5 8 10 12 15 17 19
DETECTOR(0, 4, 1) rec[-3] rec[-6] rec[-13]
DETECTOR(2, 2, 1) rec[-5] rec[-6] rec[-8] rec[-9] rec[-16]
DETECTOR(4, 4, 1) rec[-1] rec[-2] rec[-4] rec[-5] rec[-11]
DETECTOR(6, 2, 1) rec[-4] rec[-7] rec[-14]
OBSERVABLE_INCLUDE(0) rec[-7] rec[-8] rec[-9]`
  }
];

export const DEFAULT_EXAMPLE_ID = 'bit-flip-d3';

// Helper to get an example by ID
export function getExampleById(id) {
  return EXAMPLE_CIRCUITS.find(p => p.id === id);
}

// Helper to get the default circuit text
export function getDefaultCircuit() {
  const example = getExampleById(DEFAULT_EXAMPLE_ID);
  return example?.circuit || '';
}
