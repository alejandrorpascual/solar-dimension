import type { ConductorKind } from '../lib/sizing'
import { isInverterSet as isSet } from '../lib/sizing/warnings'
import type { Dictionary } from './types'
import { quoteItemsEs, quoteItemsInlineEs, quoteItemsListEs, quoteItemsShortEs, quotesEs } from './quotes-es'
import { requesterEs } from './requester-es'

/** The cable rows as a warning names them mid-sentence. */
const CONDUCTORS: Record<ConductorKind, string> = { mainCable: 'el cable principal', interconnects: 'las interconexiones', stringLeads: 'los cables de rama' }

export const es: Dictionary = {
  locale: 'es',
  ui: {
    step1: 'Electrodomésticos', step2: 'Horas de respaldo', step3: 'Paneles solares', step4: 'Tu kit', stepOf: 'Paso {n} de 4',
    project: 'Proyecto', projectName: 'Nombre del proyecto', newProject: '+ Nuevo proyecto', duplicate: 'Duplicar', delete: 'Eliminar', untitled: 'Sin nombre',
    acInverter: 'Aire acondicionado inverter', acInverterHelp: 'Arranque suave. Cuida la batería y el inversor.', acConventional: 'Aire acondicionado convencional', acConventionalHelp: 'Arranca con ~3× su potencia en marcha. Necesita un inversor más grande.', acSizeOne: '{tons} tonelada · {btu}k BTU', acSizeMany: '{tons} toneladas · {btu}k BTU',
    q1: '¿Qué aparatos deben seguir encendidos?', q1Help: 'Agrega cada uno e indica cuántos. Los vatios en marcha dimensionan la batería; los de arranque, el inversor.',
    search: 'Buscar aparatos', nothingMatches: 'Nada coincide. Prueba otra palabra o agrégalo abajo.', sectionAdded: 'Agregados: {count}',
    add: 'Agregar', addOne: 'Agregar {name}', qtyOf: 'Cantidad de {name}', removeOne: 'Quitar un {name}', remove: 'Quitar {name}',
    running: 'en marcha', surge: 'arranque', runningSurgeLine: '{watts} W en marcha · {surge} de arranque', splitPhase: 'Requiere un inversor de 240 V / fase partida',
    customTitle: '¿No está en la lista?', customHelp: 'Escribe los vatios de la etiqueta, o los voltios y amperios y nosotros los multiplicamos.',
    watts: 'Vatios', voltsAmps: 'Voltios × amperios', name: 'Nombre', runningW: 'W en marcha', volts: 'Voltios', amps: 'Amperios', surgeOptional: 'W de arranque (opcional)', sameAsRunning: 'igual que en marcha', addAppliance: 'Agregar aparato',
    errName: 'Ponle un nombre al aparato.', errNameLong: 'El nombre puede tener hasta {max} caracteres.', errVa: 'Ingresa voltios y amperios que den al menos 1 vatio.', errWatts: 'Ingresa al menos 1 vatio en marcha.', errSurge: 'El arranque no puede ser menor que los vatios en marcha.',
    errThousands: 'Escribe los vatios como número entero sin separador: 1500, no 1.500 ni 1,500.',
    q2: '¿Cuánto debe durar el respaldo?', q2Help: 'El banco se dimensiona para estas horas de tu carga, al voltaje que elijas.',
    hoursLabel: 'Horas sin red eléctrica', step2Empty: 'Vuelve y agrega al menos un aparato.',
    step2Summary: 'Tus {count} aparatos consumen {running} y usan unos {load} en {hours} horas. Dimensionamos el banco a {need} tras pérdidas del inversor y profundidad de descarga.',
    batteryVoltage: 'Voltaje del banco', batteryChemistry: 'Química de la batería', usableCapacity: '{pct}% de capacidad utilizable',
    kitFor: 'Kit para {name}', kitEmpty: 'Primero agrega aparatos.', kitSummary: 'Respalda {count} aparatos durante {hours} horas con un banco de {volts} V {chemistry}.',
    editAppliances: 'Editar aparatos', editWindow: 'Editar horas',
    runningLoad: 'Carga en marcha', averageDraw: '~{w} de promedio', startupPeak: 'Pico de arranque', batteryNeeded: 'Batería necesaria', runtime: 'Autonomía',
    part: 'Parte', specification: 'Especificación', quantity: 'Cantidad', nothingSelected: '{name} aún no tiene nada seleccionado.',
    inverterSpec: '{w} onda pura, entrada {volts} V CC', inverterNote: '{surge} de arranque · cubre {running} en marcha, {peak} pico',
    inverterNoteTight: '{surge} de arranque · {running} en marcha dejan {pct}% de margen, {peak} pico', inverterNoteUnder: '{surge} de arranque · menor que la carga en marcha de {running}',
    inverterNotePeak: '{surge} de arranque · cubre {running} en marcha, no el pico de {peak}',
    inverterParallelNote: '{count} en paralelo trabajan como un inversor de {total} y toman hasta {amps} A de las barras colectoras',
    batteriesNote: '{series} en serie × {parallel} en paralelo ({config}) · banco de {bank}, {usable} utilizables',
    mainCableSpec: '{gauge} ({mm2} mm²) de cobre, {length} m cada uno', mainCableNote: 'De batería a inversor · {amps} A de corriente de diseño{perRun} · {ampacity} A tras la corrección · {drop}% de caída al arrancar',
    interconnectsSpec: 'Puentes {gauge}, {cm} cm cada uno',
    seriesLinksNote: 'Entre baterías en serie · {amps} A de corriente de diseño · {ampacity} A tras la corrección',
    seriesLinksSharedNote: 'Entre baterías en serie, {each} puentes juntos por enlace · {amps} A de corriente de diseño cada uno · {ampacity} A tras la corrección',
    stringLeadsSpec: '{gauge} ({mm2} mm²) de cobre, {cm} cm cada uno',
    stringLeadsNote: 'Un positivo y un negativo de cada rama a las barras colectoras · {amps} A de corriente de diseño · {ampacity} A tras la corrección',
    fuseSpec: '{amps} A clase {class}{perRun}', fuseNote: 'En línea en el cable positivo, lo más cerca posible del banco', perRun: ' por tramo', perInverter: ' por inversor', perRunOfInverter: ' por tramo, {n} tramos a cada inversor',
    fuseAicNote: '{aic} kA de capacidad de interrupción', stringFuseSpec: '{amps} A clase {class}, uno por rama en paralelo', stringFuseNote: 'En el positivo de cada rama, para que una rama en corto se aísle sola',
    batteriesCurrentNote: '{cont} A continuos, {peak} A pico del banco',
    batterySize: 'Tamaño de batería', batterySizeHelp: 'Elige la batería que piensas comprar. Automático usa la menor cantidad.', batteryAuto: 'Automático',
    batteryRecommended: 'Menos baterías', batteryGroup: 'Baterías de {v} V', batteryInSeries: '{n} en serie', manyStrings: 'Muchas ramas en paralelo',
    batteryCountOne: '{count} batería', batteryCountMany: '{count} baterías', panelCountOne: '{count} panel', panelCountMany: '{count} paneles',
    inverterSizeOne: 'inversor de {w}', inverterSizeMany: '{count} inversores de {w}',
    legal: 'Legal',
    estimateNotice: 'Una estimación para pedir cotizaciones, no un diseño de instalación. Pide a un electricista matriculado que la verifique con los equipos reales y la normativa eléctrica local antes de comprar o instalar nada.',
    fine: 'Supone 90% de eficiencia del inversor, 25% de margen, {dod}% de profundidad de descarga, 1,100 W por tonelada de refrigeración, {starts}, cable de cobre con aislamiento de {insulation} °C a {ambient} °C{bundled}. Tablas de ampacidad NEC; verifica con la normativa local.',
    fineStartsOne: 'un solo motor arrancando a la vez', fineStartsTwo: 'dos motores arrancando juntos', fineStartsAll: 'todos los motores arrancando a la vez', fineBundled: ', agrupado',
    footer1: '{name} · {count} aparatos · {running} en marcha · {peak} pico', footer2: '{hours} h a {volts} V · {load} de carga', footer3: '{batteries} · {inverter} · {gauge}', footerEmpty: 'Nada seleccionado todavía',
    back: 'Atrás', next: 'Siguiente: horas de respaldo', nextSolar: 'Siguiente: paneles solares', buildKit: 'Armar mi kit', startOver: 'Empezar de nuevo',
    continueGoogle: 'Continuar con Google', orDivider: 'o', googleExists: 'Este correo ya tiene una cuenta. Inicia sesión con tu contraseña y luego conecta Google desde el menú de tu cuenta.', googleFailed: 'No se completó el inicio con Google. Inténtalo de nuevo.', connectGoogle: 'Conectar Google',
    signIn: 'Iniciar sesión', signUp: 'Crear cuenta', signOut: 'Cerrar sesión', email: 'Correo', password: 'Contraseña', noAccount: '¿No tienes cuenta? Crea una', haveAccount: '¿Ya tienes cuenta? Inicia sesión', authFailed: 'No funcionó. Revisa el correo y la contraseña.', signedInAs: 'Sesión iniciada como {email}', syncing: 'Sincronizando tus proyectos…', syncFailed: 'No se pudo guardar en tu cuenta. Los cambios quedan en este dispositivo.', language: 'Idioma',
    notFound: 'Página no encontrada', backHome: 'Volver al kit', errorTitle: 'Algo interrumpió el armado del kit.', reload: 'Recargar', updating: 'Cargando la versión más reciente…',
    projects: 'Proyectos', projectsCount: 'Proyectos · {count}', current: 'Actual', quickEdit: 'Edición rápida', done: 'Listo',
    projectMeta: '{volts} V · {hours} h · {count} aparatos', heaviestMore: '{list} y {count} más', bank: 'Banco', inverter: 'Inversor', close: 'Cerrar',
    appliancesCount: 'Aparatos · {count}', windowLabel: 'Horas', hourLess: 'Una hora menos', hourMore: 'Una hora más', hoursShort: '{hours} h',
    saved: 'Guardado', undo: 'Deshacer', allAppliances: 'Todos los aparatos',
    addApplianceSearch: 'Agregar un aparato', noSearchMatch: 'Nada coincide. Búscalo en Todos los aparatos o agrega el tuyo ahí.',
    download: 'Descargar', downloadFor: 'Descargar {name}', format: 'Formato', include: 'Incluir', preview: 'Vista previa del archivo', previewOpen: 'Ver en grande', previewTitle: 'Vista previa', previewPage: 'Página {page} de {pages}', previewImage: 'Toda la ficha en una sola imagen',
    fmtPdf: 'Ficha técnica (PDF)', fmtPdfHint: 'Para el instalador: primero las partes, luego el cuadro de cargas.', fmtPng: 'Imagen resumen (PNG)', fmtPngHint: 'La ficha en una sola imagen. Ideal para WhatsApp.',
    fmtCsv: 'Lista de partes (CSV)', fmtCsvHint: 'Se abre en Excel. Para cotizar con un proveedor. Usa las listas de aparatos y partes.',
    incSummary: 'Cifras resumen', incAppliances: 'Lista de aparatos', incParts: 'Lista de partes', incNotes: 'Supuestos', incRequester: 'Datos del solicitante',
    downloadPdf: 'Descargar PDF', downloadPng: 'Descargar imagen', downloadCsv: 'Descargar CSV', share: 'Compartir', making: 'Preparando el archivo…', downloadReady: 'Archivo listo. Descarga iniciada.',
    exportFailed: 'No se pudo crear el archivo. Inténtalo de nuevo.',
    sheetAttention: 'Leer antes de cotizar', sheetAttentionChecks: 'Verificaciones por resolver: {count}', sheetAttentionNotes: 'Notas: {count}', sheetNotes: 'Notas',
    sheetTitle: 'Kit de respaldo · ficha técnica', loadSchedule: 'Cuadro de cargas', appliance: 'Aparato', each: 'C/u', overHours: 'En {hours} h', total: 'Total', note: 'Nota',
    eachW: 'C/u (W)', runningWatts: 'En marcha (W)', whOver: 'Wh en {hours} h',
    q3: '¿Tienes espacio en el techo para paneles?', q3Help: 'Los paneles recargan el banco de día, así que un apagón más largo que las horas de respaldo queda cubierto. Puedes saltarte este paso y quedarte con un kit solo de baterías.',
    solarNo: 'No, solo baterías', solarNoHelp: 'El banco se recarga desde la red o un generador', solarYes: 'Sí, agregar paneles', solarYesHelp: 'Indica el espacio del techo y luego ajusta los paneles',
    solarSkipped: 'Perfecto. El kit queda como está. Puedes volver a este paso cuando quieras.',
    roofSpace: 'Espacio disponible en el techo', roofLess: 'Cinco metros cuadrados menos', roofMore: 'Cinco metros cuadrados más', roofFitsOne: 'Cabe {panels} con pasillos.', roofFitsMany: 'Caben {panels} con pasillos.', roofHint: '¿No estás seguro? Mídelo a pasos: un panel es como una puerta acostada.',
    plannerLabel: 'Planificador del techo · toca para agregar o quitar', plannerTile: '1 casilla = un panel de {w}', addPanel: 'Agregar panel {n}', removePanel: 'Quitar panel {n}',
    panelsLine: '{panels} · {kw}', recommendedPill: 'Recomendado · recarga el banco en un día', recommendedPillLimited: 'Recomendado · lo máximo que cabe en tu techo', backToRecommended: 'Volver a lo recomendado · {n}',
    sunHours: 'Horas de sol pleno al día', sunHint: 'Caracas promedia unas 4,8 h. Baja el valor si el techo mira lejos del sol o hay árboles que dan sombra.',
    clearDay: 'En un día despejado', flowSun: 'de sol pleno', flowBank: 'banco de {volts} V · {batteries}', flowHome: '{count} aparatos · {hours} h',
    coverFull: 'Cubre el consumo de un día completo', coverPart: 'Cubre parte del consumo de un día', coverAxis: 'consumo de un día · {use}',
    refillSameDay: 'Banco lleno tras unas {hours} de sol, con {spare} de sobra.', refillDays: 'El banco se recarga en unos {days} días de sol.', noPanelsYet: 'Aún no hay paneles. Toca el techo.',
    cloudyDay: 'Día nublado (40%)', cloudyNote: '{wh}, cerca del {pct}% del consumo de un día.',
    solarAssumptions: 'Supone 75% de eficiencia de panel a batería y sin sombra al mediodía. Tu kit suma paneles, un controlador de carga MPPT, cable fotovoltaico, un seccionador de CC y la estructura.',
    solarRecharge: 'Recarga solar', solarRechargeSub: '{wh} en un día despejado',
    footerSolar: '{hours} h a {volts} V · {load} de carga · {panels}, {kw}', footerSolarNone: '{hours} h a {volts} V · {load} de carga · sin paneles', footer4Solar: '{batteries} · {inverter} · {gauge} · {panels}',
    solarPanelsSpec: '{w} monocristalino, {size}', solarPanelsNote: '{strings} · arreglo de {kw} · unos {m2} m² con pasillos',
    chargeControllerSpec: 'MPPT {amps} A · {voc} V máx. FV · banco de {volts} V', chargeControllerNote: '{chargeA} A hacia el banco a pleno sol · {stringVoc} V en circuito abierto por cadena',
    pvCableSpec: 'Cable solar de {mm2} mm² ({awg}), {length} m cada uno', pvCableNote: 'Del techo al controlador · un par por cadena · terminales MC4',
    pvDisconnectSpec: 'Breaker de CC de {amps} A, 500 V', pvDisconnectNote: 'Entre los paneles y el controlador, accesible desde el suelo',
    mountingSpec: 'Rieles de aluminio y grapas para {panels}', mountingNote: 'Inclinación de 10° hacia el sur en techo plano; a ras en techo inclinado',
    solarTag: 'Solar', fineSolar: ' La parte solar supone paneles de {w}, 75% de eficiencia de panel a batería y {sun} horas de sol pleno al día.',
    stringsOne: '1 cadena de {n} en serie', stringsMany: '{strings} cadenas de hasta {n} en serie',
    average: 'Promedio', averageWatts: 'Promedio (W)', kind: 'Tipo',
    runsLabel: 'Funciona', dutyOf: '{name}: parte de cada hora que funciona', dutyOption: '{pct}% de cada hora', dutyTypical: '{pct}% · típico', dutyNonstop: '100% · no se apaga',
    rename: 'Renombrar', projectActions: 'Más acciones de {name}', stepLocked: 'Agrega al menos un aparato primero', stepGo: 'Paso {n}: {label}', dutyRuns: 'Funciona · {pct}% de cada hora', dutyBursts: '~{min} min por hora', dutyTypicalAt: 'típico {pct}%', averageDrawFor: '~{w} de promedio entre los {qty}',
    startsLabel: 'Motores que arrancan a la vez',
    startsOne: 'Uno a la vez', startsOneHelp: 'Lo típico: arranca el motor más grande mientras los demás funcionan.',
    startsTwo: 'Dos a la vez', startsTwoHelp: 'La nevera y el aire pueden arrancar en el mismo segundo.',
    startsAll: 'Todos a la vez', startsAllHelp: 'Todo arranca junto cuando se va la red.',
    cableRun: 'Tramo de cable', cableSummary: '{length} m · {ambient} °C · cable de {insulation} °C{bundled}', cableBundledShort: ' · agrupados',
    runLength: 'De la batería al inversor, un sentido', ambientLabel: 'Temperatura alrededor de los cables',
    ambient30: '30 °C · cuarto fresco', ambient40: '40 °C · garaje, cuarto de máquinas', ambient50: '50 °C · ático o caja al sol',
    bundledLabel: 'Los cables van en un mismo tubo o atados', bundledHelp: 'La capacidad baja al 80%',
    insulationLabel: 'Aislamiento del cable', insulation75: '75 °C · THW, cable de soldadura', insulation90: '90 °C · THHN, XHHW-2, cable de batería común',
    runtimeRange: '{worst} en un día duro · {best} en un día ligero',
    checks: 'Verificaciones', incChecks: 'Verificaciones', checkPass: 'Cumple', checkWarn: 'Revisar',
    checkSurge: 'Inversor', checkSurgeOk: '{running} en marcha con un inversor de {inverter} · {peak} durante {seconds} s, dentro de sus {rating} de arranque',
    checkSurgeOkMany: '{running} en marcha con {count} inversores de {unit} ({inverter} en total) · {peak} durante {seconds} s, dentro de sus {rating} de arranque',
    checkSurgeContributors: '{running} en marcha + {list} arrancando',
    checkBatteryContinuous: 'Corriente continua de la batería', checkBatteryContinuousOk: 'El banco entrega {bankA} A continuos; el inversor toma hasta {needA} A',
    checkBatteryContinuousOkMany: 'El banco entrega {bankA} A continuos; los {count} inversores toman hasta {needA} A en total',
    checkBatteryPeak: 'Corriente pico de la batería', checkBatteryPeakOk: 'El pico del banco, {bankA} A, cubre los {needA} A de arranque durante {seconds} s',
    checkParallel: 'Ramas en paralelo', checkParallelOk: '{parallel} en paralelo, dentro de las {max} que permite el fabricante', checkParallelSingle: 'Una sola rama, nada que balancear',
    checkFuse: 'Fusible', checkFuseOk: '{amps} A clase {class}: bajo los {ampacity} A del cable, {aic} kA de interrupción, arranque de {startA} A dentro de lo que aguanta',
    checkCable: 'Cable', checkCableOk: '{gauge} soporta {ampacity} A tras la corrección ({ambient} °C{bundled}) para {designA} A de diseño{perRun} · {drop}% de caída al arrancar',
  },
  categories: { All: 'Todos', Kitchen: 'Cocina', Living: 'Sala', Climate: 'Clima', 'Air conditioning': 'Aire acondicionado', Work: 'Trabajo', Utility: 'Servicios', Security: 'Seguridad', Personal: 'Personal', Custom: 'Personalizados' },
  chemistries: { lifepo4: 'litio LiFePO₄', agm: 'plomo-ácido AGM' },
  voltageHints: { 12: 'Sistemas pequeños hasta ~2 kW', 24: 'Medianos, hasta ~5 kW', 36: 'Poco común; bancos de carrito de golf', 48: 'Casa completa, 3 kW o más' },
  warnings: {
    inverterVoltage: (p) => `Los inversores de ${p.inverterW?.toLocaleString('es-419')} W normalmente son de ${p.voltsList} V. Cambia el voltaje del banco o reduce la carga.`,
    highCurrent: (p) => `${p.amps?.toLocaleString('es-419')} A ${isSet(p) ? 'hacia cada inversor' : 'en el lado de CC'} a ${p.volts} V es difícil de cablear con seguridad${p.nextVolts ? `. Considera ${p.nextVolts} V.` : '.'}`,
    parallelStrings: (p) => `${p.strings} ramas en paralelo se desbalancean. Prefiere unidades más grandes o un voltaje mayor.`,
    dominantLoad: (p) => `${p.itemName} es el ${p.sharePct}% de la energía. Quitarlo es la forma más barata de reducir el banco.`,
    splitPhase: (p) => `${p.itemName} normalmente funciona a 240 V. Necesitas un inversor de fase partida (240 V) o dos unidades acopladas.`,
    inverterUndersized: (p) => {
      const [inverter, unit, running] = [p.inverterW ?? 0, p.unitW ?? 0, p.runningW ?? 0].map((n) => n.toLocaleString('es-419'))
      const isUnder = (p.inverterW ?? 0) < (p.runningW ?? 0)
      // A set is already the most the list can put in parallel, so the advice no longer points there.
      if (isSet(p)) {
        const advice = 'Reduce la carga o pregunta a un instalador por un sistema hecho para ella.'
        const set = `Los ${p.inverters} inversores de ${unit} W en paralelo (${inverter} W)`
        return isUnder
          ? `${set} son menores que la carga en marcha de ${running} W y no pueden sostenerla. ${advice}`
          : `${set} dejan ${p.headroomPct}% de margen sobre la carga en marcha de ${running} W; este kit prevé ${p.needPct}%. ${advice}`
      }
      const advice = 'Reduce la carga o pregunta a un instalador por un inversor mayor o por equipos hechos para trabajar en paralelo.'
      return isUnder
        ? `El inversor de ${inverter} W es menor que la carga en marcha de ${running} W y no puede sostenerla. ${advice}`
        : `El inversor de ${inverter} W deja ${p.headroomPct}% de margen sobre la carga en marcha de ${running} W; este kit prevé ${p.needPct}%. ${advice}`
    },
    surgeDuration: (p) => {
      const start = `Un arranque de ${p.surgeW?.toLocaleString('es-419')} W durante ${p.seconds} s supera la ventana de arranque`
      return isSet(p)
        ? `${start} de los ${p.inverters} inversores de ${p.unitW?.toLocaleString('es-419')} W; juntos solo sostienen ${p.ratedW?.toLocaleString('es-419')} W ese tiempo. Deja que arranquen menos motores a la vez.`
        : `${start} del inversor de ${p.inverterW?.toLocaleString('es-419')} W; solo sostiene ${p.ratedW?.toLocaleString('es-419')} W ese tiempo. Elige un inversor mayor o deja que arranquen menos motores a la vez.`
    },
    bankDischarge: (p) => `${isSet(p) ? `Los ${p.inverters} inversores toman hasta ${p.needA?.toLocaleString('es-419')} A en total` : `El inversor toma hasta ${p.needA?.toLocaleString('es-419')} A`} a plena carga; ${p.strings} × ${p.unitLabel} permite ${p.maxA?.toLocaleString('es-419')} A continuos y su BMS cortaría. Elige una unidad mayor o más voltaje.`,
    bankPeak: (p) => `El arranque exige ${p.needA?.toLocaleString('es-419')} A durante ${p.seconds} s; el BMS del banco permite ${p.maxA?.toLocaleString('es-419')} A pico y podría apagarse. Deja que arranquen menos motores a la vez o agrega una rama.`,
    fuseAboveBank: (p) => `El fusible de ${p.fuseA} A está dimensionado para más de los ${p.maxA?.toLocaleString('es-419')} A que el banco puede entregar, así que cortaría el BMS y no el fusible en una sobrecarga. Elige un banco que entregue más.`,
    fuseAboveCable: (p) => `Ni ${p.count} tramos del cable más grueso soportan más de ${p.maxA?.toLocaleString('es-419')} A cada uno, menos que el fusible de ${p.fuseA} A que necesitan. Sube el voltaje o reduce la carga.`,
    fuseSurge: (p) => `El arranque pasa ${p.surgeA?.toLocaleString('es-419')} A por un fusible de ${p.fuseA} A durante ${p.seconds} s; puede quemarse en un arranque normal. El siguiente tamaño aún protege el cable.`,
    fuseInterrupt: (p) => `Un banco en corto puede entregar unos ${p.shortCircuitA?.toLocaleString('es-419')} A, más que los ${p.aicA?.toLocaleString('es-419')} A de interrupción del fusible. Usa un fusible con esa capacidad o menos ramas.`,
    startupDrop: (p) => `El cable cae ${p.dropPct}% con la corriente de arranque; el inversor puede apagarse cuando arranque un motor. Acorta el tramo o sube un calibre.`,
    cableAmbient: (p) => `Ningún cable de la tabla está certificado para aire a ${p.ambientC} °C. Lleva el tramo a un lugar más fresco.`,
    cableUndersized: (p) => `El ${p.gauge} para ${CONDUCTORS[p.conductor ?? 'mainCable']} solo soporta ${p.maxA?.toLocaleString('es-419')} A tras la corrección, menos que su corriente de diseño de ${p.needA?.toLocaleString('es-419')} A. Sube el voltaje, reduce la carga o lleva el banco a un lugar más fresco.`,
    missingAppliances: (p) => p.count === 1
      ? 'No se pudo cargar 1 aparato de este proyecto, así que este kit lo deja fuera. Recarga en un minuto; si sigue faltando, agrégalo de nuevo.'
      : `No se pudieron cargar ${p.count} aparatos de este proyecto, así que este kit los deja fuera. Recarga en un minuto; si siguen faltando, agrégalos de nuevo.`,
    roofLimited: (p) => `En tu techo caben ${p.fit} paneles; con ${p.need} el banco se recargaría en un día despejado. Igual se recarga en más días de sol.`,
  },
  parts: { inverter: 'Inversor', batteries: 'Baterías', mainCable: 'Cable principal', interconnects: 'Interconexiones', stringLeads: 'Cables de rama', fuse: 'Fusible', stringFuses: 'Fusibles por rama', solarPanels: 'Paneles solares', chargeController: 'Controlador de carga', pvCable: 'Cable fotovoltaico', pvDisconnect: 'Seccionador FV', mounting: 'Estructura'  },
  kinds: { continuous: 'Siempre encendidos', cycling: 'Encienden y apagan', momentary: 'Ráfagas cortas' },
  parallelNotes: {
    sameModelAge: 'Mismo modelo y edad en cada rama',
    equalLeadsOrBusbar: 'Cables de igual largo a una barra colectora',
    stringFuses: 'Un fusible en cada rama',
    bmsComms: 'BMS enlazados (CAN o RS485) para que repartan la carga',
  },
  inverterNotes: {
    builtForParallel: 'Mismo modelo, hechos y enlazados para trabajar en paralelo',
    ownRunAndFuse: 'Cada uno con sus propios cables con fusible, de igual largo, desde las barras colectoras',
  },
  privacy: {
    title: 'Privacidad',
    updated: 'Última actualización: {date}',
    sections: [
      { heading: 'Qué guardamos', body: 'Tu correo y tu nombre y, si inicias sesión con Google, el identificador de tu cuenta de Google. También guardamos los proyectos que guardes: aparatos, horas, voltaje y elección de baterías y, si los añades, los datos del solicitante para la ficha (nombre, número de documento, teléfono, correo y dirección). Los clientes que guardas con "Guardar en mis clientes", y un formulario de cliente que cerraste sin guardar, se quedan solo en este navegador. Si subes cotizaciones de instaladores, guardamos los archivos y los precios y componentes que leemos de ellos.' },
      { heading: 'Para qué', body: 'Para iniciar tu sesión y mantener tus proyectos en todos tus dispositivos. Si subes cotizaciones de instaladores, también las leemos para compararlas con tu kit (mira Cotizaciones más abajo).' },
      { heading: 'Con quién lo compartimos', body: 'No vendemos ni compartimos tus datos, salvo con los proveedores que hacen funcionar la app: Vercel y Neon para el alojamiento y la base de datos y, si subes cotizaciones de instaladores, OpenAI para leerlas (mira Cotizaciones más abajo).' },
      { heading: 'Cotizaciones', body: 'Si subes cotizaciones de instaladores, guardamos los archivos de forma privada en Vercel y enviamos cada uno a OpenAI para leer sus precios y componentes, enviándolo de nuevo si falla una lectura o lo reintentas. OpenAI no entrena con los datos enviados a través de su API. Guardamos cuántas cotizaciones subes cada mes para aplicar el límite mensual; ese recuento se mantiene aunque borres una cotización. Al eliminar una cotización, o el proyecto al que pertenece, se elimina el archivo.' },
      { heading: 'Datos de Google', body: 'Solo pedimos tu perfil básico (nombre y correo). No accedemos a Gmail, Drive ni a nada más de tu cuenta de Google.' },
      { heading: 'Cookies', body: 'Una cookie de sesión para iniciar sesión y una de idioma. Sin anuncios ni rastreo.' },
      { heading: 'Borrar tus datos', body: 'Escribe a {email} y borraremos tu cuenta y tus proyectos.' },
    ],
  },
  terms: {
    title: 'Términos de uso',
    updated: 'Última actualización: {date}',
    sections: [
      { heading: 'Qué es esto', body: 'Solar Dimension estima el inversor, las baterías, los cables y los fusibles de un sistema de respaldo a partir de los aparatos y las horas que indiques. Es de uso gratuito.' },
      { heading: 'Estimaciones, no un plan de instalación', body: 'Los resultados son estimaciones basadas en consumos típicos de los aparatos y en los supuestos que se muestran en la página del kit. Pide a un electricista matriculado que revise el diseño según la normativa eléctrica local antes de comprar o instalar nada. Las baterías y el cableado de corriente continua pueden causar incendios o lesiones si se instalan mal.' },
      { heading: 'Sin garantía', body: 'La app se ofrece "tal cual", sin garantías de ningún tipo. No garantizamos que los resultados sean exactos, completos o adecuados para tu caso.' },
      { heading: 'Limitación de responsabilidad', body: 'En la medida en que la ley lo permita, no somos responsables de ninguna pérdida o daño derivado del uso de la app o de confiar en sus resultados.' },
      { heading: 'Tu cuenta', body: 'Mantén tu contraseña en privado. Puedes pedirnos que borremos tu cuenta en cualquier momento (ver Privacidad).' },
      { heading: 'Cambios', body: 'Podemos actualizar estos términos. La fecha de arriba indica la versión vigente.' },
      { heading: 'Contacto', body: '{email}' },
    ],
  },
  quotes: quotesEs,
  requester: requesterEs,
  quoteItems: quoteItemsEs,
  quoteItemsInline: quoteItemsInlineEs,
  quoteItemsShort: quoteItemsShortEs,
  quoteItemsList: quoteItemsListEs,
}
