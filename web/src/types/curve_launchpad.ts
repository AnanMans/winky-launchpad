/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/curve_launchpad.json`.
 */
export type CurveLaunchpad = {
  "address": "CvwMz6fbxqGNKAY9XmVABaGk3X3ZPSEncoChXr7eK1sQ",
  "metadata": {
    "name": "curveLaunchpad",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "createCurve",
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
            "Payer of rent/fees"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "creator"
        },
        {
          "name": "mint"
        },
        {
          "name": "curvePda",
          "writable": true
        },
        {
          "name": "vaultSolPda",
          "writable": true
        },
        {
          "name": "reserveTokenAta",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createArgs"
            }
          }
        }
      ]
    },
    {
      "name": "graduate",
      "discriminator": [
        45,
        235,
        225,
        181,
        17,
        218,
        64,
        130
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Anyone can trigger when threshold reached"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "curvePda",
          "writable": true
        },
        {
          "name": "vaultSolPda",
          "writable": true
        },
        {
          "name": "reserveTokenAta",
          "writable": true
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
          "name": "user",
          "docs": [
            "User paying SOL"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "curvePda"
        },
        {
          "name": "vaultSolPda",
          "writable": true
        },
        {
          "name": "reserveTokenAta",
          "writable": true
        },
        {
          "name": "buyerAta",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "tradeBuyArgs"
            }
          }
        }
      ]
    },
    {
      "name": "tradeSell",
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
          "name": "user",
          "docs": [
            "User selling tokens"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "curvePda"
        },
        {
          "name": "vaultSolPda",
          "writable": true
        },
        {
          "name": "reserveTokenAta",
          "writable": true
        },
        {
          "name": "sellerAta",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "tradeSellArgs"
            }
          }
        }
      ]
    }
  ],
  "events": [
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
      "name": "eventGraduated",
      "discriminator": [
        135,
        158,
        132,
        6,
        81,
        205,
        174,
        195
      ]
    },
    {
      "name": "eventTrade",
      "discriminator": [
        183,
        212,
        34,
        229,
        129,
        48,
        37,
        229
      ]
    }
  ],
  "types": [
    {
      "name": "createArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "curveType",
            "type": "u8"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "params",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "eventCurveCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "eventGraduated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "eventTrade",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "user",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "tradeBuyArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lamportsIn",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tradeSellArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokensIn",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
