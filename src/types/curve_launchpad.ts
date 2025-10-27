/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/curve_launchpad.json`.
 */
export type CurveLaunchpad = {
  "address": "AfQmD1aufqxQCrctzoJSzDxtHz9C3ig2NYtmK42tACk6",
  "metadata": {
    "name": "curveLaunchpad",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "createCurve",
      "docs": [
        "Initialize the curve PDA and pin its bumps.",
        "Client must include the `state` init account & seeds."
      ],
      "discriminator": [
        169,
        235,
        221,
        223,
        65,
        109,
        120,
        183
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "The creator pays rent for the new PDA"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "state",
          "docs": [
            "Curve state PDA: seeds = [\"curve\", mint]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mintAuthPda",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "tradeBuy",
      "docs": [
        "\"Buy\" in SOL-only phase:",
        "- The actual SOL transfer must be part of the same transaction,",
        "from the payer to the `state` PDA (system transfer built client-side).",
        "- We just enforce the accounts and log an event."
      ],
      "discriminator": [
        173,
        172,
        52,
        244,
        61,
        65,
        216,
        118
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "state",
          "docs": [
            "The curve state PDA that receives SOL (via separate system transfer)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "tradeSell",
      "docs": [
        "\"Sell\" in SOL-only phase:",
        "Move SOL from the PDA to the user **by mutating lamports directly**.",
        "Do NOT CPI to SystemProgram::transfer from a data-bearing PDA."
      ],
      "discriminator": [
        59,
        162,
        77,
        109,
        9,
        82,
        216,
        160
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "state",
          "docs": [
            "The curve state PDA that holds SOL to be paid out"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Admin-only: withdraw SOL from the curve PDA to any destination.",
        "Only the original creator stored in `state.creator` can call this."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "creator",
          "docs": [
            "Must be the creator saved in the state"
          ],
          "signer": true
        },
        {
          "name": "to",
          "writable": true
        },
        {
          "name": "state",
          "docs": [
            "Curve state PDA that holds the SOL"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "state.mint",
                "account": "curveState"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "curveState",
      "discriminator": [
        198,
        152,
        48,
        255,
        91,
        4,
        10,
        197
      ]
    }
  ],
  "events": [
    {
      "name": "eventBuy",
      "discriminator": [
        76,
        52,
        7,
        199,
        14,
        37,
        158,
        12
      ]
    },
    {
      "name": "eventCurveCreated",
      "discriminator": [
        206,
        209,
        198,
        233,
        136,
        122,
        134,
        1
      ]
    },
    {
      "name": "eventSell",
      "discriminator": [
        72,
        121,
        24,
        156,
        199,
        248,
        235,
        72
      ]
    },
    {
      "name": "eventWithdraw",
      "discriminator": [
        216,
        247,
        255,
        93,
        80,
        238,
        33,
        136
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be > 0"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6002,
      "name": "insufficientFunds",
      "msg": "Insufficient funds"
    }
  ],
  "types": [
    {
      "name": "curveState",
      "docs": [
        "On-chain state for a single curve (per mint)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "bumpCurve",
            "type": "u8"
          },
          {
            "name": "bumpMintAuth",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "eventBuy",
      "docs": [
        "Emitted on every buy (we only log here in SOL-only phase)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "eventCurveCreated",
      "docs": [
        "Emitted once on successful curve creation"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "eventSell",
      "docs": [
        "Emitted on every sell (SOL-only phase)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "eventWithdraw",
      "docs": [
        "Emitted on admin withdraws"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
