import type { CatalogItem } from './catalog'
import { toCatalogItem, type ApplianceRecord } from './catalog-schema'

/**
 * The catalog as first seeded into Postgres (migration 0004). Served when the database cannot be read, and the
 * fixture for engine tests. The drift test keeps it equal to the seed migration.
 */
export const APPLIANCE_SEED: readonly ApplianceRecord[] = [
  {
    "id": "fridge",
    "category": "Kitchen",
    "watts": 150,
    "surge": 1200,
    "duty": 0.35,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Refrigerator",
        "note": "Compressor cycles ~35% of each hour"
      },
      "es": {
        "name": "Refrigerador",
        "note": "El compresor trabaja ~35% de cada hora"
      }
    },
    "sortOrder": 10,
    "retired": false
  },
  {
    "id": "freezer",
    "category": "Kitchen",
    "watts": 100,
    "surge": 900,
    "duty": 0.3,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Chest freezer",
        "note": "Cycles ~30% of each hour"
      },
      "es": {
        "name": "Congelador horizontal",
        "note": "Trabaja ~30% de cada hora"
      }
    },
    "sortOrder": 20,
    "retired": false
  },
  {
    "id": "micro",
    "category": "Kitchen",
    "watts": 1200,
    "surge": 1500,
    "duty": 0.08,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Microwave (1000 W)",
        "note": "~5 min per hour of use"
      },
      "es": {
        "name": "Microondas (1000 W)",
        "note": "~5 min por hora de uso"
      }
    },
    "sortOrder": 30,
    "retired": false
  },
  {
    "id": "coffee",
    "category": "Kitchen",
    "watts": 900,
    "surge": 900,
    "duty": 0.08,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Coffee maker",
        "note": "Brews ~5 min per hour"
      },
      "es": {
        "name": "Cafetera",
        "note": "Prepara ~5 min por hora"
      }
    },
    "sortOrder": 40,
    "retired": false
  },
  {
    "id": "kettle",
    "category": "Kitchen",
    "watts": 1500,
    "surge": 1500,
    "duty": 0.05,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Electric kettle",
        "note": "~3 min per hour"
      },
      "es": {
        "name": "Hervidor eléctrico",
        "note": "~3 min por hora"
      }
    },
    "sortOrder": 50,
    "retired": false
  },
  {
    "id": "toaster",
    "category": "Kitchen",
    "watts": 1000,
    "surge": 1000,
    "duty": 0.04,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Toaster",
        "note": "~2 min per hour"
      },
      "es": {
        "name": "Tostadora",
        "note": "~2 min por hora"
      }
    },
    "sortOrder": 60,
    "retired": false
  },
  {
    "id": "lights",
    "category": "Living",
    "watts": 90,
    "surge": 90,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "LED lighting (10 bulbs)",
        "note": "Continuous"
      },
      "es": {
        "name": "Iluminación LED (10 focos)",
        "note": "Continuo"
      }
    },
    "sortOrder": 70,
    "retired": false
  },
  {
    "id": "tv",
    "category": "Living",
    "watts": 120,
    "surge": 120,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "TV, 55-inch LED",
        "note": "Continuous"
      },
      "es": {
        "name": "TV LED de 55\"",
        "note": "Continuo"
      }
    },
    "sortOrder": 80,
    "retired": false
  },
  {
    "id": "console",
    "category": "Living",
    "watts": 150,
    "surge": 150,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Game console",
        "note": "Continuous"
      },
      "es": {
        "name": "Consola de videojuegos",
        "note": "Continuo"
      }
    },
    "sortOrder": 90,
    "retired": false
  },
  {
    "id": "fan",
    "category": "Climate",
    "watts": 75,
    "surge": 150,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Ceiling fan",
        "note": "Continuous"
      },
      "es": {
        "name": "Ventilador de techo",
        "note": "Continuo"
      }
    },
    "sortOrder": 100,
    "retired": false
  },
  {
    "id": "heater",
    "category": "Climate",
    "watts": 1500,
    "surge": 1500,
    "duty": 0.5,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Space heater",
        "note": "Thermostat cycles ~50%"
      },
      "es": {
        "name": "Calefactor",
        "note": "El termostato trabaja ~50%"
      }
    },
    "sortOrder": 110,
    "retired": false
  },
  {
    "id": "ac1i",
    "category": "Air conditioning",
    "watts": 1100,
    "surge": 1430,
    "duty": 0.6,
    "tons": 1,
    "acType": "inverter",
    "labels": {
      "en": {
        "name": "1 ton AC · inverter",
        "note": "12k BTU · Inverter compressor · soft start"
      },
      "es": {
        "name": "Aire de 1 tonelada · inverter",
        "note": "12k BTU · Compresor inverter · arranque suave"
      }
    },
    "sortOrder": 120,
    "retired": false
  },
  {
    "id": "ac1c",
    "category": "Air conditioning",
    "watts": 1100,
    "surge": 3300,
    "duty": 0.5,
    "tons": 1,
    "acType": "conventional",
    "labels": {
      "en": {
        "name": "1 ton AC · conventional",
        "note": "12k BTU · Conventional compressor · ~3× start surge"
      },
      "es": {
        "name": "Aire de 1 tonelada · convencional",
        "note": "12k BTU · Compresor convencional · arranque ~3×"
      }
    },
    "sortOrder": 130,
    "retired": false
  },
  {
    "id": "ac15i",
    "category": "Air conditioning",
    "watts": 1650,
    "surge": 2145,
    "duty": 0.6,
    "tons": 1.5,
    "acType": "inverter",
    "labels": {
      "en": {
        "name": "1.5 ton AC · inverter",
        "note": "18k BTU · Inverter compressor · soft start"
      },
      "es": {
        "name": "Aire de 1.5 toneladas · inverter",
        "note": "18k BTU · Compresor inverter · arranque suave"
      }
    },
    "sortOrder": 140,
    "retired": false
  },
  {
    "id": "ac15c",
    "category": "Air conditioning",
    "watts": 1650,
    "surge": 4950,
    "duty": 0.5,
    "tons": 1.5,
    "acType": "conventional",
    "labels": {
      "en": {
        "name": "1.5 ton AC · conventional",
        "note": "18k BTU · Conventional compressor · ~3× start surge"
      },
      "es": {
        "name": "Aire de 1.5 toneladas · convencional",
        "note": "18k BTU · Compresor convencional · arranque ~3×"
      }
    },
    "sortOrder": 150,
    "retired": false
  },
  {
    "id": "ac2i",
    "category": "Air conditioning",
    "watts": 2200,
    "surge": 2860,
    "duty": 0.6,
    "tons": 2,
    "acType": "inverter",
    "labels": {
      "en": {
        "name": "2 ton AC · inverter",
        "note": "24k BTU · Inverter compressor · soft start"
      },
      "es": {
        "name": "Aire de 2 toneladas · inverter",
        "note": "24k BTU · Compresor inverter · arranque suave"
      }
    },
    "sortOrder": 160,
    "retired": false
  },
  {
    "id": "ac2c",
    "category": "Air conditioning",
    "watts": 2200,
    "surge": 6600,
    "duty": 0.5,
    "tons": 2,
    "acType": "conventional",
    "labels": {
      "en": {
        "name": "2 ton AC · conventional",
        "note": "24k BTU · Conventional compressor · ~3× start surge"
      },
      "es": {
        "name": "Aire de 2 toneladas · convencional",
        "note": "24k BTU · Compresor convencional · arranque ~3×"
      }
    },
    "sortOrder": 170,
    "retired": false
  },
  {
    "id": "ac3i",
    "category": "Air conditioning",
    "watts": 3300,
    "surge": 4290,
    "duty": 0.6,
    "tons": 3,
    "acType": "inverter",
    "labels": {
      "en": {
        "name": "3 ton AC · inverter",
        "note": "36k BTU · Inverter compressor · soft start"
      },
      "es": {
        "name": "Aire de 3 toneladas · inverter",
        "note": "36k BTU · Compresor inverter · arranque suave"
      }
    },
    "sortOrder": 180,
    "retired": false
  },
  {
    "id": "ac3c",
    "category": "Air conditioning",
    "watts": 3300,
    "surge": 9900,
    "duty": 0.5,
    "tons": 3,
    "acType": "conventional",
    "labels": {
      "en": {
        "name": "3 ton AC · conventional",
        "note": "36k BTU · Conventional compressor · ~3× start surge"
      },
      "es": {
        "name": "Aire de 3 toneladas · convencional",
        "note": "36k BTU · Compresor convencional · arranque ~3×"
      }
    },
    "sortOrder": 190,
    "retired": false
  },
  {
    "id": "ac4i",
    "category": "Air conditioning",
    "watts": 4400,
    "surge": 5720,
    "duty": 0.6,
    "tons": 4,
    "acType": "inverter",
    "labels": {
      "en": {
        "name": "4 ton AC · inverter",
        "note": "48k BTU · Inverter compressor · soft start"
      },
      "es": {
        "name": "Aire de 4 toneladas · inverter",
        "note": "48k BTU · Compresor inverter · arranque suave"
      }
    },
    "sortOrder": 200,
    "retired": false
  },
  {
    "id": "ac4c",
    "category": "Air conditioning",
    "watts": 4400,
    "surge": 13200,
    "duty": 0.5,
    "tons": 4,
    "acType": "conventional",
    "labels": {
      "en": {
        "name": "4 ton AC · conventional",
        "note": "48k BTU · Conventional compressor · ~3× start surge"
      },
      "es": {
        "name": "Aire de 4 toneladas · convencional",
        "note": "48k BTU · Compresor convencional · arranque ~3×"
      }
    },
    "sortOrder": 210,
    "retired": false
  },
  {
    "id": "ac5i",
    "category": "Air conditioning",
    "watts": 5500,
    "surge": 7150,
    "duty": 0.6,
    "tons": 5,
    "acType": "inverter",
    "labels": {
      "en": {
        "name": "5 ton AC · inverter",
        "note": "60k BTU · Inverter compressor · soft start"
      },
      "es": {
        "name": "Aire de 5 toneladas · inverter",
        "note": "60k BTU · Compresor inverter · arranque suave"
      }
    },
    "sortOrder": 220,
    "retired": false
  },
  {
    "id": "ac5c",
    "category": "Air conditioning",
    "watts": 5500,
    "surge": 16500,
    "duty": 0.5,
    "tons": 5,
    "acType": "conventional",
    "labels": {
      "en": {
        "name": "5 ton AC · conventional",
        "note": "60k BTU · Conventional compressor · ~3× start surge"
      },
      "es": {
        "name": "Aire de 5 toneladas · convencional",
        "note": "60k BTU · Compresor convencional · arranque ~3×"
      }
    },
    "sortOrder": 230,
    "retired": false
  },
  {
    "id": "router",
    "category": "Work",
    "watts": 20,
    "surge": 20,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Wi-Fi router + modem",
        "note": "Continuous"
      },
      "es": {
        "name": "Router Wi-Fi + módem",
        "note": "Continuo"
      }
    },
    "sortOrder": 240,
    "retired": false
  },
  {
    "id": "laptop",
    "category": "Work",
    "watts": 65,
    "surge": 65,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Laptop",
        "note": "Continuous"
      },
      "es": {
        "name": "Laptop",
        "note": "Continuo"
      }
    },
    "sortOrder": 250,
    "retired": false
  },
  {
    "id": "desktop",
    "category": "Work",
    "watts": 300,
    "surge": 400,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Desktop PC + monitor",
        "note": "Continuous"
      },
      "es": {
        "name": "PC de escritorio + monitor",
        "note": "Continuo"
      }
    },
    "sortOrder": 260,
    "retired": false
  },
  {
    "id": "phone",
    "category": "Work",
    "watts": 10,
    "surge": 10,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Phone charger",
        "note": "Continuous"
      },
      "es": {
        "name": "Cargador de celular",
        "note": "Continuo"
      }
    },
    "sortOrder": 270,
    "retired": false
  },
  {
    "id": "washer",
    "category": "Utility",
    "watts": 500,
    "surge": 1500,
    "duty": 0.3,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Washing machine",
        "note": "Motor start surge"
      },
      "es": {
        "name": "Lavadora",
        "note": "Pico de arranque del motor"
      }
    },
    "sortOrder": 280,
    "retired": false
  },
  {
    "id": "well",
    "category": "Utility",
    "watts": 1000,
    "surge": 3000,
    "duty": 0.1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Well pump, 1/2 HP",
        "note": "Runs ~6 min per hour"
      },
      "es": {
        "name": "Bomba de pozo, 1/2 HP",
        "note": "Funciona ~6 min por hora"
      }
    },
    "sortOrder": 290,
    "retired": false
  },
  {
    "id": "sump",
    "category": "Utility",
    "watts": 800,
    "surge": 2000,
    "duty": 0.1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Sump pump, 1/3 HP",
        "note": "Runs ~6 min per hour"
      },
      "es": {
        "name": "Bomba de achique, 1/3 HP",
        "note": "Funciona ~6 min por hora"
      }
    },
    "sortOrder": 300,
    "retired": false
  },
  {
    "id": "wheater",
    "category": "Utility",
    "watts": 4500,
    "surge": 4500,
    "duty": 0.25,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Electric water heater",
        "note": "Heavy: cycles ~25%"
      },
      "es": {
        "name": "Calentador de agua eléctrico",
        "note": "Pesado: trabaja ~25%"
      }
    },
    "sortOrder": 310,
    "retired": false
  },
  {
    "id": "cctv",
    "category": "Security",
    "watts": 7,
    "surge": 7,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "CCTV camera",
        "note": "Continuous · includes IR night vision and PoE losses"
      },
      "es": {
        "name": "Cámara de CCTV",
        "note": "Continuo · incluye visión nocturna IR y pérdidas PoE"
      }
    },
    "sortOrder": 320,
    "retired": false
  },
  {
    "id": "nvr16",
    "category": "Security",
    "watts": 20,
    "surge": 20,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Recorder (NVR/DVR), up to 16 cameras",
        "note": "Continuous · 1 hard drive"
      },
      "es": {
        "name": "Grabador (NVR/DVR), hasta 16 cámaras",
        "note": "Continuo · 1 disco duro"
      }
    },
    "sortOrder": 330,
    "retired": false
  },
  {
    "id": "nvr32",
    "category": "Security",
    "watts": 50,
    "surge": 50,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Recorder (NVR/DVR), 32+ cameras",
        "note": "Continuous · 4 hard drives"
      },
      "es": {
        "name": "Grabador (NVR/DVR), 32+ cámaras",
        "note": "Continuo · 4 discos duros"
      }
    },
    "sortOrder": 340,
    "retired": false
  },
  {
    "id": "cpap",
    "category": "Personal",
    "watts": 40,
    "surge": 40,
    "duty": 1,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "CPAP machine",
        "note": "Continuous"
      },
      "es": {
        "name": "Equipo CPAP",
        "note": "Continuo"
      }
    },
    "sortOrder": 350,
    "retired": false
  },
  {
    "id": "dryer",
    "category": "Personal",
    "watts": 1500,
    "surge": 1500,
    "duty": 0.05,
    "tons": null,
    "acType": null,
    "labels": {
      "en": {
        "name": "Hair dryer",
        "note": "~3 min per hour"
      },
      "es": {
        "name": "Secadora de cabello",
        "note": "~3 min por hora"
      }
    },
    "sortOrder": 360,
    "retired": false
  }
]

/**
 * Momentary loads added by migration 0012: motors that run for seconds at a time. Their energy comes from the bursts;
 * the stored duty only shows the same figure. Typical residential operators; confirm against a datasheet before
 * changing them.
 */
export const APPLIANCE_SEED_MOMENTARY: readonly ApplianceRecord[] = [
  {
    id: 'gate-slide', category: 'Security', watts: 550, surge: 1650, duty: 0.033, tons: null, acType: null,
    kind: 'momentary', surgeClass: 'motor', burstSeconds: 20, cyclesPerHour: 6,
    labels: {
      en: { name: 'Sliding gate motor', note: '~20 s per open or close, 6 an hour' },
      es: { name: 'Motor de portón corredizo', note: '~20 s por apertura o cierre, 6 por hora' },
    },
    sortOrder: 342, retired: false,
  },
  {
    id: 'gate-swing', category: 'Security', watts: 300, surge: 900, duty: 0.025, tons: null, acType: null,
    kind: 'momentary', surgeClass: 'motor', burstSeconds: 15, cyclesPerHour: 6,
    labels: {
      en: { name: 'Swing gate motor', note: '~15 s per open or close, 6 an hour' },
      es: { name: 'Motor de portón batiente', note: '~15 s por apertura o cierre, 6 por hora' },
    },
    sortOrder: 344, retired: false,
  },
  {
    id: 'barrier', category: 'Security', watts: 150, surge: 450, duty: 0.033, tons: null, acType: null,
    kind: 'momentary', surgeClass: 'motor', burstSeconds: 4, cyclesPerHour: 30,
    labels: {
      en: { name: 'Parking barrier', note: '4 s lifts, 30 an hour' },
      es: { name: 'Barrera de estacionamiento', note: 'Subidas de 4 s, 30 por hora' },
    },
    sortOrder: 346, retired: false,
  },
]

/** Every seeded appliance in sort order, as the engine sees it. */
export const CATALOG_SNAPSHOT: readonly CatalogItem[] = [...APPLIANCE_SEED, ...APPLIANCE_SEED_MOMENTARY]
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map(toCatalogItem)
