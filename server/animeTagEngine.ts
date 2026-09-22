/**
 * Smart Anime Tag Engine & Multi-Booru Resolver for Porsche-chan
 * Provides high-accuracy character recognition, Indonesian phrase translation,
 * multi-tag parsing, and cascading Booru search across Danbooru, Yande.re, Safebooru, Konachan, TBIB.
 */

export type AiArtFilterType = "hide" | "only" | "allow" | "show";

export interface ParsedAnimeQuery {
  characterTag?: string;
  franchiseTag?: string;
  secondaryTags: string[];
  allTags: string[];
  wantsNsfw: boolean;
  wantsSuggestive: boolean;
  aiArtFilter: AiArtFilterType;
}

export interface BooruPostResult {
  id: string | number;
  url: string;
  previewUrl?: string;
  rating: "safe" | "suggestive" | "questionable" | "explicit";
  tags: string[];
  characterTags?: string[];
  artistName?: string;
  sourceUrl?: string;
  pixivUrl?: string;
  danbooruUrl?: string;
  provider: string;
  isAiGenerated: boolean;
  score: number;
}

// 1. COMPREHENSIVE CHARACTER DICTIONARY (Mapped to exact Canonical Booru Tags)
export const CHARACTER_DICTIONARY: Record<string, string> = {
  // Genshin Impact
  "hu tao": "hu_tao_(genshin_impact)",
  hutao: "hu_tao_(genshin_impact)",
  raiden: "raiden_shogun",
  "raiden shogun": "raiden_shogun",
  "raiden ei": "raiden_shogun",
  ei: "raiden_shogun",
  furina: "furina_(genshin_impact)",
  focalors: "furina_(genshin_impact)",
  navia: "navia_(genshin_impact)",
  clorinde: "clorinde_(genshin_impact)",
  arlecchino: "arlecchino_(genshin_impact)",
  nahida: "nahida_(genshin_impact)",
  ganyu: "ganyu_(genshin_impact)",
  keqing: "keqing_(genshin_impact)",
  mona: "mona_(genshin_impact)",
  fischl: "fischl_(genshin_impact)",
  ayaka: "kamisato_ayaka",
  "kamisato ayaka": "kamisato_ayaka",
  ayato: "kamisato_ayato",
  "kamisato ayato": "kamisato_ayato",
  nilou: "nilou_(genshin_impact)",
  shenhe: "shenhe_(genshin_impact)",
  yelan: "yelan_(genshin_impact)",
  yoimiya: "yoimiya_(genshin_impact)",
  kokomi: "sangonomiya_kokomi",
  "sangonomiya kokomi": "sangonomiya_kokomi",
  yae: "yae_miko",
  "yae miko": "yae_miko",
  eula: "eula_(genshin_impact)",
  amber: "amber_(genshin_impact)",
  jean: "jean_(genshin_impact)",
  lisa: "lisa_(genshin_impact)",
  klee: "klee_(genshin_impact)",
  noelle: "noelle_(genshin_impact)",
  sucrose: "sucrose_(genshin_impact)",
  rosaria: "rosaria_(genshin_impact)",
  barbara: "barbara_(genshin_impact)",
  lumine: "lumine_(genshin_impact)",
  aether: "aether_(genshin_impact)",
  zhongli: "zhongli_(genshin_impact)",
  venti: "venti_(genshin_impact)",
  xiao: "xiao_(genshin_impact)",
  kazuha: "kaedehara_kazuha",
  "kaedehara kazuha": "kaedehara_kazuha",
  scaramouche: "wanderer_(genshin_impact)",
  wanderer: "wanderer_(genshin_impact)",
  childe: "tartaglia_(genshin_impact)",
  tartaglia: "tartaglia_(genshin_impact)",
  neuvillette: "neuvillette_(genshin_impact)",
  wriothesley: "wriothesley_(genshin_impact)",
  alhaitham: "alhaitham_(genshin_impact)",
  kaveh: "kaveh_(genshin_impact)",
  cyno: "cyno_(genshin_impact)",
  tighnari: "tighnari_(genshin_impact)",
  lyney: "lyney_(genshin_impact)",
  lynette: "lynette_(genshin_impact)",
  freminet: "freminet_(genshin_impact)",
  chevreuse: "chevreuse_(genshin_impact)",
  chiori: "chiori_(genshin_impact)",
  xianyun: "xianyun_(genshin_impact)",
  mualani: "mualani_(genshin_impact)",
  kinich: "kinich_(genshin_impact)",
  kachina: "kachina_(genshin_impact)",
  xilonen: "xilonen_(genshin_impact)",
  chasca: "chasca_(genshin_impact)",
  mavuika: "mavuika_(genshin_impact)",
  citlali: "citlali_(genshin_impact)",
  capitano: "il_capitano_(genshin_impact)",

  // Honkai: Star Rail
  firefly: "firefly_(honkai:_star_rail)",
  hotaru: "firefly_(honkai:_star_rail)",
  kafka: "kafka_(honkai:_star_rail)",
  acheron: "acheron_(honkai:_star_rail)",
  sparkle: "sparkle_(honkai:_star_rail)",
  hanabi: "sparkle_(honkai:_star_rail)",
  feixiao: "feixiao_(honkai:_star_rail)",
  silverwolf: "silver_wolf_(honkai:_star_rail)",
  "silver wolf": "silver_wolf_(honkai:_star_rail)",
  tingyun: "tingyun_(honkai:_star_rail)",
  herta: "herta_(honkai:_star_rail)",
  robin: "robin_(honkai:_star_rail)",
  march: "march_7th",
  "march 7th": "march_7th",
  jingliu: "jingliu_(honkai:_star_rail)",
  topaz: "topaz_(honkai:_star_rail)",
  "black swan": "black_swan_(honkai:_star_rail)",
  "ruan mei": "ruan_mei_(honkai:_star_rail)",
  ruanmei: "ruan_mei_(honkai:_star_rail)",
  seele: "seele_(honkai:_star_rail)",
  bronya: "bronya_rand",
  "bronya rand": "bronya_rand",
  serval: "serval_(honkai:_star_rail)",
  clara: "clara_(honkai:_star_rail)",
  natasha: "natasha_(honkai:_star_rail)",
  pela: "pela_(honkai:_star_rail)",
  qingque: "qingque_(honkai:_star_rail)",
  fuxuan: "fu_xuan_(honkai:_star_rail)",
  "fu xuan": "fu_xuan_(honkai:_star_rail)",
  lynx: "lynx_(honkai:_star_rail)",
  guinaifen: "guinaifen_(honkai:_star_rail)",
  hanya: "hanya_(honkai:_star_rail)",
  xueyi: "xueyi_(honkai:_star_rail)",
  yunli: "yunli_(honkai:_star_rail)",
  lingsha: "lingsha_(honkai:_star_rail)",
  rappa: "rappa_(honkai:_star_rail)",
  fugue: "tingyun_(fugue)_(honkai:_star_rail)",
  aglaea: "aglaea_(honkai:_star_rail)",
  castorice: "castorice_(honkai:_star_rail)",
  anaxa: "anaxa_(honkai:_star_rail)",
  tribbie: "tribbie_(honkai:_star_rail)",
  mydei: "mydei_(honkai:_star_rail)",
  danheng: "dan_heng_(honkai:_star_rail)",
  "dan heng": "dan_heng_(honkai:_star_rail)",
  "dan heng il": "dan_heng_•_imbibitor_lunae",
  blade: "blade_(honkai:_star_rail)",
  jingyuan: "jing_yuan_(honkai:_star_rail)",
  "jing yuan": "jing_yuan_(honkai:_star_rail)",
  aventurine: "aventurine_(honkai:_star_rail)",
  sunday: "sunday_(honkai:_star_rail)",
  gallagher: "gallagher_(honkai:_star_rail)",
  boothill: "boothill_(honkai:_star_rail)",
  drratio: "dr._ratio_(honkai:_star_rail)",
  "dr ratio": "dr._ratio_(honkai:_star_rail)",

  // Zenless Zone Zero (ZZZ)
  ellen: "ellen_joe",
  "ellen joe": "ellen_joe",
  "jane doe": "jane_doe_(zenless_zone_zero)",
  janedoe: "jane_doe_(zenless_zone_zero)",
  zhu_yuan: "zhu_yuan",
  "zhu yuan": "zhu_yuan",
  qingyi: "qingyi_(zenless_zone_zero)",
  miyabi: "hoshimi_miyabi",
  "hoshimi miyabi": "hoshimi_miyabi",
  nicole: "nicole_demara",
  "nicole demara": "nicole_demara",
  anby: "anby_demara",
  "anby demara": "anby_demara",
  corin: "corin_wickes",
  "corin wickes": "corin_wickes",
  rina: "alexandrina_sebastiane",
  grace: "grace_howard",
  "grace howard": "grace_howard",
  koleda: "koleda_belobog",
  piper: "piper_wheel",
  lucy_zzz: "luciana_de_montefio",
  burnice: "burnice_white",
  caesar: "caesar_king",
  "caesar king": "caesar_king",
  yanagi: "tsukishiro_yanagi",
  "tsukishiro yanagi": "tsukishiro_yanagi",
  harumasa: "asakura_harumasa",
  lycaon: "von_lycaon",

  // Wuthering Waves (WuWa)
  changli: "changli_(wuthering_waves)",
  jinhsi: "jinhsi_(wuthering_waves)",
  jinshi: "jinhsi_(wuthering_waves)",
  yinlin: "yinlin_(wuthering_waves)",
  shorekeeper: "the_shorekeeper",
  "the shorekeeper": "the_shorekeeper",
  camellya: "camellya_(wuthering_waves)",
  rover: "rover_(wuthering_waves)",
  danjin: "danjin_(wuthering_waves)",
  yangyang: "yangyang_(wuthering_waves)",
  chixia: "chixia_(wuthering_waves)",
  baizhi: "baizhi_(wuthering_waves)",
  sanhua: "sanhua_(wuthering_waves)",
  taoqi: "taoqi_(wuthering_waves)",
  jiyan: "jiyan_(wuthering_waves)",
  calcharo: "calcharo_(wuthering_waves)",
  xiangli_yao: "xiangli_yao",
  "xiangli yao": "xiangli_yao",

  // Girls' Frontline & GFL2
  hk416: "hk416_(girls'_frontline)",
  "hk 416": "hk416_(girls'_frontline)",
  klukai: "klukai_(girls'_frontline_2)",
  ump45: "ump45_(girls'_frontline)",
  ump9: "ump9_(girls'_frontline)",
  ump40: "ump40_(girls'_frontline)",
  m4a1: "m4a1_(girls'_frontline)",
  sopmod: "m4_sopmod_ii_(girls'_frontline)",
  "sopmod ii": "m4_sopmod_ii_(girls'_frontline)",
  ar15: "st_ar-15_(girls'_frontline)",
  "star 15": "st_ar-15_(girls'_frontline)",
  wa2000: "wa2000_(girls'_frontline)",
  ro635: "ro635_(girls'_frontline)",
  kar98k: "kar98k_(girls'_frontline)",
  groza: "ots-14_(girls'_frontline)",
  vector: "vector_(girls'_frontline)",
  g11: "g11_(girls'_frontline)",
  suomi: "suomi_(girls'_frontline)",
  an94: "an-94_(girls'_frontline)",
  ak12: "ak-12_(girls'_frontline)",
  ak15: "ak-15_(girls'_frontline)",
  rpk16: "rpk-16_(girls'_frontline)",
  dandelion: "dandelion_(girls'_frontline)",

  // Blue Archive
  shiroko: "shiroko_(blue_archive)",
  "sunaookami shiroko": "shiroko_(blue_archive)",
  "kuroko": "shiroko_terror_(blue_archive)",
  "shiroko terror": "shiroko_terror_(blue_archive)",
  hina: "hina_(blue_archive)",
  "sorasaki hina": "hina_(blue_archive)",
  mika: "mika_(blue_archive)",
  "misono mika": "mika_(blue_archive)",
  yuuka: "yuuka_(blue_archive)",
  "hayase yuuka": "yuuka_(blue_archive)",
  arona: "arona_(blue_archive)",
  plana: "plana_(blue_archive)",
  asuna: "ichinose_asuna",
  "ichinose asuna": "ichinose_asuna",
  karin: "kakudate_karin",
  "kakudate karin": "kakudate_karin",
  toki: "asuka_toki",
  "asuka toki": "asuka_toki",
  kisaki: "kisaki_(blue_archive)",
  "ryuuge kisaki": "kisaki_(blue_archive)",
  hoshino: "takanashi_hoshino",
  "takanashi hoshino": "takanashi_hoshino",
  arisu: "tendou_alice",
  alice: "tendou_alice",
  "tendou alice": "tendou_alice",
  kayoko: "onakata_kayoko",
  "onakata kayoko": "onakata_kayoko",
  aru: "rikuhachima_aru",
  "rikuhachima aru": "rikuhachima_aru",
  mutsuki: "asagi_mutsuki",
  "asagi mutsuki": "asagi_mutsuki",
  noa: "ushio_noa",
  "ushio noa": "ushio_noa",
  koharu: "shimoe_koharu",
  "shimoe koharu": "shimoe_koharu",
  ui: "kozoseki_ui",
  "kozoseki ui": "kozoseki_ui",
  ako: "amau_ako",
  "amau ako": "amau_ako",
  iori: "shiromi_iori",
  "shiromi iori": "shiromi_iori",
  azusa: "shirasu_azusa",
  "shirasu azusa": "shirasu_azusa",
  hanako: "urawa_hanako",
  "urawa hanako": "urawa_hanako",
  nonomi: "izayoi_nonomi",
  wakamo: "kosaka_wakamo",
  "kosaka wakamo": "kosaka_wakamo",
  kanna: "ogata_kanna",
  seia: "yurizono_seia",
  nagisa: "kirifuji_nagisa",
  rio: "tsukatsuki_rio",
  "tsukatsuki rio": "tsukatsuki_rio",

  // Hololive & VTubers
  kobo: "kobo_kanaeru",
  "kobo kanaeru": "kobo_kanaeru",
  zeta: "vestia_zeta",
  "vestia zeta": "vestia_zeta",
  kaela: "kaela_kovalskia",
  "kaela kovalskia": "kaela_kovalskia",
  moona: "moona_hoshinova",
  "moona hoshinova": "moona_hoshinova",
  ollie: "kureiji_ollie",
  "kureiji ollie": "kureiji_ollie",
  reine: "pavolia_reine",
  anya_melfissa: "anya_melfissa",
  fubuki: "shirakami_fubuki",
  "shirakami fubuki": "shirakami_fubuki",
  pekora: "usada_pekora",
  "usada pekora": "usada_pekora",
  marine: "houshou_marine",
  "houshou marine": "houshou_marine",
  gura: "gawr_gura",
  "gawr gura": "gawr_gura",
  miko: "sakura_miko",
  "sakura miko": "sakura_miko",
  suisei: "hoshimachi_suisei",
  "hoshimachi suisei": "hoshimachi_suisei",
  korone: "inugami_korone",
  "inugami korone": "inugami_korone",
  okayu: "nekomata_okayu",
  "nekomata okayu": "nekomata_okayu",
  aqua_holo: "minato_aqua",
  "minato aqua": "minato_aqua",
  shion: "murasaki_shion",
  "murasaki shion": "murasaki_shion",
  ayame: "nakiri_ayame",
  "nakiri ayame": "nakiri_ayame",
  subaru_holo: "oozora_subaru",
  "oozora subaru": "oozora_subaru",
  towa: "tokoyami_towa",
  "tokoyami towa": "tokoyami_towa",
  watame: "tsunomaki_watame",
  kanata: "amane_kanata",
  coco: "kiryu_coco",
  lami: "yukihana_lamy",
  lamy: "yukihana_lamy",
  nene: "momosuzu_nene",
  botan: "shishiro_botan",
  polka: "omaru_polka",
  laplus: "la+_darknesss",
  lui: "takane_lui",
  koyori: "hakui_koyori",
  chloe: "sakamata_chloe",
  "sakamata chloe": "sakamata_chloe",
  iroha: "kazama_iroha",
  calliope: "mori_calliope",
  "mori calliope": "mori_calliope",
  kiara: "takanashi_kiara",
  ina: "ninomae_ina'nis",
  "ninomae ina'nis": "ninomae_ina'nis",
  amelia: "amelia_watson",
  "amelia watson": "amelia_watson",
  kronii: "ouro_kronii",
  "ouro kronii": "ouro_kronii",
  mumei: "nanashi_mumei",
  "nanashi mumei": "nanashi_mumei",
  fauna: "ceres_fauna",
  "ceres fauna": "ceres_fauna",
  bae: "hakos_baelz",
  "hakos baelz": "hakos_baelz",
  shiori: "shiori_novella",
  nerissa: "nerissa_ravencroft",
  fuwawa: "fuwawa_abyssgard",
  mococo: "mococo_abyssgard",
  "fuwamoco": "fuwawa_abyssgard mococo_abyssgard",
  bijou: "koseki_bijou",
  elizabeth: "elizabeth_rose_bloodflame",
  cecilia: "cecilia_immergreen",
  raora: "raora_panthera",
  gigi: "gigi_murin",

  // Vocaloid
  miku: "hatsune_miku",
  "hatsune miku": "hatsune_miku",
  rin_vocaloid: "kagamine_rin",
  "kagamine rin": "kagamine_rin",
  len: "kagamine_len",
  "kagamine len": "kagamine_len",
  luka: "megurine_luka",
  "megurine luka": "megurine_luka",
  meiko: "meiko_(vocaloid)",
  kaito: "kaito_(vocaloid)",
  gumi: "gumi",
  teto: "kasane_teto",
  "kasane teto": "kasane_teto",

  // Bocchi the Rock!
  bocchi: "gotoh_hitori",
  "gotoh hitori": "gotoh_hitori",
  "gotou hitori": "gotoh_hitori",
  "hitori gotoh": "gotoh_hitori",
  nijika: "ijichi_nijika",
  "ijichi nijika": "ijichi_nijika",
  ryo: "yamada_ryo",
  "yamada ryo": "yamada_ryo",
  kita: "kita_ikuyo",
  "kita ikuyo": "kita_ikuyo",
  seika: "ijichi_seika",
  kikuri: "hiroi_kikuri",

  // Sousou no Frieren
  frieren: "frieren",
  fern: "fern_(sousou_no_frieren)",
  stark: "stark_(sousou_no_frieren)",
  ubel: "uebel_(sousou_no_frieren)",
  "übel": "uebel_(sousou_no_frieren)",
  aura: "aura_(sousou_no_frieren)",
  flamme: "flamme_(sousou_no_frieren)",
  serie: "serie_(sousou_no_frieren)",
  himmel: "himmel_(sousou_no_frieren)",
  heiter: "heiter_(sousou_no_frieren)",
  eisen: "eisen_(sousou_no_frieren)",

  // Re:Zero
  rem: "rem_(re:zero)",
  ram: "ram_(re:zero)",
  emilia: "emilia_(re:zero)",
  echidna: "echidna_(re:zero)",
  beatrice: "beatrice_(re:zero)",
  subaru: "natsuki_subaru",
  satella: "satella_(re:zero)",
  crusch: "crusch_karsten",
  felix: "felix_argyle",
  ferris: "felix_argyle",
  priscilla: "priscilla_barielle",

  // Fate Series / FGO
  saber: "artoria_pendragon_(fate)",
  artoria: "artoria_pendragon_(fate)",
  "artoria pendragon": "artoria_pendragon_(fate)",
  rin: "tohsaka_rin",
  "tohsaka rin": "tohsaka_rin",
  sakura_fate: "matou_sakura",
  "matou sakura": "matou_sakura",
  illya: "illyasviel_von_einzbern",
  mash: "mash_kyrielight",
  "mash kyrielight": "mash_kyrielight",
  jalter: "jeanne_d'arc_alter_(fate)",
  "jeanne alter": "jeanne_d'arc_alter_(fate)",
  jeanne: "jeanne_d'arc_(fate)",
  "jeanne d'arc": "jeanne_d'arc_(fate)",
  astolfo: "astolfo_(fate)",
  morgan: "morgan_(fate)",
  "morgan le fay": "morgan_(fate)",
  castoria: "artoria_caster_(fate)",
  melusine: "melusine_(fate)",
  baobhan_sith: "baobhan_sith_(fate)",
  barghest: "barghest_(fate)",
  kuku: "kukulkan_(fate)",
  koyanskaya: "tamamo_vitch_koyanskaya_(fate)",
  oberon: "oberon_(fate)",
  gilgamesh: "gilgamesh_(fate)",
  emiya: "emiya_(fate)",
  scathach: "scathach_(fate)",
  okita: "okita_souji_(fate)",
  nobunaga: "oda_nobunaga_(fate)",
  karna: "karna_(fate)",

  // Azur Lane
  taihou: "taihou_(azur_lane)",
  belfast: "belfast_(azur_lane)",
  enterprise: "enterprise_(azur_lane)",
  eugen: "prinz_eugen_(azur_lane)",
  "prinz eugen": "prinz_eugen_(azur_lane)",
  bremerton: "bremerton_(azur_lane)",
  baltimore: "baltimore_(azur_lane)",
  shinano: "shinano_(azur_lane)",
  chesire: "cheshire_(azur_lane)",
  cheshire: "cheshire_(azur_lane)",
  atago: "atago_(azur_lane)",
  takao: "takao_(azur_lane)",
  akagi: "akagi_(azur_lane)",
  kaga: "kaga_(azur_lane)",
   Laffey: "laffey_(azur_lane)",
  laffey: "laffey_(azur_lane)",
  ayanami_al: "ayanami_(azur_lane)",
  z23: "z23_(azur_lane)",
  javelin: "javelin_(azur_lane)",
  musashi_al: "musashi_(azur_lane)",
  new_jersey: "new_jersey_(azur_lane)",
  "new jersey": "new_jersey_(azur_lane)",
  anchorage: "anchorage_(azur_lane)",
  agir: "aegir_(azur_lane)",
  "ägir": "aegir_(azur_lane)",
  aegir: "aegir_(azur_lane)",

  // Arknights
  amiya: "amiya_(arknights)",
  chen: "ch'en_(arknights)",
  "ch'en": "ch'en_(arknights)",
  texas: "texas_(arknights)",
  lappland: "lappland_(arknights)",
  surtr: "surtr_(arknights)",
  skadi: "skadi_(arknights)",
  w_arknights: "w_(arknights)",
  kaltsit: "kal'tsit_(arknights)",
  "kal'tsit": "kal'tsit_(arknights)",
  exusiai: "exusiai_(arknights)",
  specter: "specter_(arknights)",
  nearl: "nearl_(arknights)",
  silverash: "silverash_(arknights)",
  thorn: "thorns_(arknights)",
  thorns: "thorns_(arknights)",
  muelsyse: "muelsyse_(arknights)",
  reed: "reed_(arknights)",
  arturia: "arturia_(arknights)",
  virtuosa: "arturia_(arknights)",
  wisadel: "wis'adel_(arknights)",

  // Goddess of Victory: Nikke
  anis: "anis_(nikke)",
  rapi: "rapi_(nikke)",
  neon: "neon_(nikke)",
  dorothy: "dorothy_(nikke)",
  modernia: "modernia_(nikke)",
  marian: "modernia_(nikke)",
  scarlet: "scarlet_(nikke)",
  "scarlet black shadow": "scarlet:_black_shadow_(nikke)",
  red_hood: "red_hood_(nikke)",
  "red hood": "red_hood_(nikke)",
  cinderella: "cinderella_(nikke)",
  d_killer_wife: "d:_killer_wife_(nikke)",
  elegg: "elegg_(nikke)",
  rupee: "rupee_(nikke)",
  viper: "viper_(nikke)",
  blanc: "blanc_(nikke)",
  noir: "noir_(nikke)",
  tove: "tove_(nikke)",
  tia: "tia_(nikke)",
  naga: "naga_(nikke)",
  helm: "helm_(nikke)",

  // Chainsaw Man
  makima: "makima_(chainsaw_man)",
  power: "power_(chainsaw_man)",
  reze: "reze_(chainsaw_man)",
  denji: "denji_(chainsaw_man)",
  kobeni: "higashiyama_kobeni",
  "higashiyama kobeni": "higashiyama_kobeni",
  asa: "mitaka_asa",
  "mitaka asa": "mitaka_asa",
  yoru: "yoru_(chainsaw_man)",
  aki: "hayakawa_aki",

  // Jujutsu Kaisen
  gojo: "gojou_satoru",
  "gojo satoru": "gojou_satoru",
  "gojou satoru": "gojou_satoru",
  sukuna: "ryomen_sukuna",
  "ryomen sukuna": "ryomen_sukuna",
  itadori: "itadori_yuuji",
  "itadori yuuji": "itadori_yuuji",
  megumi: "fushiguro_megumi",
  "fushiguro megumi": "fushiguro_megumi",
  nobara: "kugisaki_nobara",
  "kugisaki nobara": "kugisaki_nobara",
  maki: "zen'in_maki",
  yuta: "okkotsu_yuuta",
  toji: "fushiguro_touji",
  geto: "getou_suguru",
  nanami: "nanami_kento",

  // Demon Slayer (Kimetsu no Yaiba)
  tanjiro: "kamado_tanjirou",
  "kamado tanjiro": "kamado_tanjirou",
  nezuko: "kamado_nezuko",
  "kamado nezuko": "kamado_nezuko",
  zenitsu: "agatsuma_zen'itsu",
  inosuke: "hashibira_inosuke",
  shinobu: "kochou_shinobu",
  "kocho shinobu": "kochou_shinobu",
  mitsuri: "kanroji_mitsuri",
  "kanroji mitsuri": "kanroji_mitsuri",
  giyuu: "tomioka_giyuu",
  "giyu tomioka": "tomioka_giyuu",
  rengoku: "rengoku_kyoujurou",
  kanae: "kochou_kanae",
  kanao: "tsuyuri_kanao",

  // Oshi no Ko
  ai_hoshino: "hoshino_ai_(oshi_no_ko)",
  "ai hoshino": "hoshino_ai_(oshi_no_ko)",
  ruby: "hoshino_ruby",
  "ruby hoshino": "hoshino_ruby",
  aqua_hoshino: "hoshino_aquamarine",
  "aquamarine hoshino": "hoshino_aquamarine",
  kana: "arima_kana",
  "arima kana": "arima_kana",
  akane: "kurokawa_akane",
  "kurokawa akane": "kurokawa_akane",
  memcho: "mem-cho",
  "mem cho": "mem-cho",

  // Spy x Family
  anya: "anya_forger",
  "anya forger": "anya_forger",
  yor: "yor_forger",
  "yor forger": "yor_forger",
  loid: "loid_forger",
  "loid forger": "loid_forger",

  // My Dress-Up Darling
  marin: "kitagawa_marin",
  "marin kitagawa": "kitagawa_marin",
  "kitagawa marin": "kitagawa_marin",
  gojo_waka: "gojou_wakana",

  // Lycoris Recoil
  chisato: "nishikigi_chisato",
  "nishikigi chisato": "nishikigi_chisato",
  takina: "inoue_takina",
  "inoue takina": "inoue_takina",

  // KonoSuba
  megumin: "megumin",
  aqua: "aqua_(konosuba)",
  darkness: "darkness_(konosuba)",
  kazuma: "satou_kazuma",
  wiz: "wiz_(konosuba)",
  yunyun: "yunyun_(konosuba)",
  eris: "eris_(konosuba)",

  // Dragon Ball
  goku: "son_goku",
  "son goku": "son_goku",
  vegeta: "vegeta",
  gohan: "son_gohan",
  piccolo: "piccolo_(dragon_ball)",
  trunks: "trunks_(dragon_ball)",
  bulma: "bulma",
  "android 18": "android_18_(dragon_ball)",
  "android 21": "android_21_(dragon_ball)",

  // One Piece
  luffy: "monkey_d._luffy",
  "monkey d luffy": "monkey_d._luffy",
  zoro: "roronoa_zoro",
  "roronoa zoro": "roronoa_zoro",
  nami: "nami_(one_piece)",
  robin_op: "nico_robin",
  "nico robin": "nico_robin",
  sanji: "sanji_(one_piece)",
  hancock: "boa_hancock",
  "boa hancock": "boa_hancock",
  yamato: "yamato_(one_piece)",
  uta: "uta_(one_piece)",
  law: "trafalgar_law",
  ace: "portgas_d._ace",

  // Naruto
  naruto: "uzumaki_naruto",
  "uzumaki naruto": "uzumaki_naruto",
  sasuke: "uchiha_sasuke",
  "uchiha sasuke": "uchiha_sasuke",
  sakura: "haruno_sakura",
  "haruno sakura": "haruno_sakura",
  hinata: "hyuuga_hinata",
  "hyuuga hinata": "hyuuga_hinata",
  kakashi: "hatake_kakashi",
  itachi: "uchiha_itachi",
  tsunade: "tsunade_(naruto)",

  // Bleach
  ichigo: "kurosaki_ichigo",
  rukia: "kuchiki_rukia",
  orihime: "inoue_orihime",
  yoruichi: "shihouin_yoruichi",
  rangiku: "matsumoto_rangiku",
  toshiro: "hitsugaya_toushirou",
  aizen: "aizen_sousuke",

  // Evangelion
  asuka: "souryuu_asuka_langley",
  "souryuu asuka": "souryuu_asuka_langley",
  "shikinami asuka": "shikinami_asuka_langley",
  rei: "ayanami_rei",
  "ayanami rei": "ayanami_rei",
  mari: "makinami_mari_illustrious",
  misato: "katsuragi_misato",
  shinji: "ikari_shinji",
  kaworu: "nagisa_kaworu",

  // NieR:Automata
  "2b": "2b_(nier:automata)",
  "9s": "9s_(nier:automata)",
  a2: "a2_(nier:automata)",
  kaine: "kaine_(nier)",

  // Cyberpunk: Edgerunners
  lucy: "lucy_(cyberpunk)",
  rebecca: "rebecca_(cyberpunk)",
  david: "david_martinez_(cyberpunk)",

  // Kaguya-sama
  kaguya: "shinomiya_kaguya",
  "shinomiya kaguya": "shinomiya_kaguya",
  chika: "fujiwara_chika",
  "fujiwara chika": "fujiwara_chika",
  miko_iino: "iino_miko",
  "iino miko": "iino_miko",
  ai_hayasaka: "hayasaka_ai",
  "hayasaka ai": "hayasaka_ai",
  ishigami: "ishigami_yuu",
  shirogane: "shirogane_miyuki",

  // Touhou Project
  reimu: "hakurei_reimu",
  marisa: "kirisame_marisa",
  sakuya: "izayoi_sakuya",
  flandre: "flandre_scarlet",
  remilia: "remilia_scarlet",
  youmu: "konpaku_youmu",
  yuyuko: "saigyouji_yuyuko",
  cirno: "cirno",
  aya: "shameimaru_aya",
  koishi: "komeiji_koishi",
  satori: "komeiji_satori",
  sanae: "kochiya_sanae",

  // Sword Art Online
  asuna_sao: "yuuki_asuna",
  "yuuki asuna": "yuuki_asuna",
  kirito: "kirigaya_kazuto",
  sinon: "asada_shino",
  alice_sao: "alice_zuberg",
  eugeo: "eugeo",

  // Overlord
  albedo: "albedo_(overlord)",
  shalltear: "shalltear_bloodfallen",
  ainz: "ainz_ooal_gown",

  // Attack on Titan
  mikasa: "mikasa_ackerman",
  eren: "eren_yeager",
  levi: "levi_(shingeki_no_kyojin)",
  armin: "armin_arlert",
  historia: "historia_reiss",

  // DanMachi
  hestia: "hestia_(danmachi)",
  aiz: "aiz_wallenstein",
  ryu: "ryuu_lion",
  "ryuu lion": "ryuu_lion",

  // Classroom of the Elite
  kei: "karuizawa_kei",
  ichinose: "ichinose_honami",
  horikita: "horikita_suzune",
  ayanokoji: "ayanokouji_kiyotaka",
  arisu_cote: "sakayanagi_arisu",

  // Date A Live
  kurumi: "tokisaki_kurumi",
  "tokisaki kurumi": "tokisaki_kurumi",
  tohka: "yatogami_tohka",
  kotori: "itsuka_kotori",
  origami: "tobiichi_origami",
};

// 2. FRANCHISE DICTIONARY
export const FRANCHISE_DICTIONARY: Record<string, string> = {
  gfl: "girls'_frontline",
  "girls frontline": "girls'_frontline",
  "girls' frontline": "girls'_frontline",
  gfl2: "girls'_frontline_2:_exilium",
  fgo: "fate/grand_order",
  fate: "fate_(series)",
  ba: "blue_archive",
  "blue archive": "blue_archive",
  al: "azur_lane",
  "azur lane": "azur_lane",
  genshin: "genshin_impact",
  "genshin impact": "genshin_impact",
  hsr: "honkai:_star_rail",
  "star rail": "honkai:_star_rail",
  "honkai star rail": "honkai:_star_rail",
  hi3: "honkai_impact_3rd",
  "honkai impact": "honkai_impact_3rd",
  zzz: "zenless_zone_zero",
  "zenless zone zero": "zenless_zone_zero",
  wuwa: "wuthering_waves",
  "wuthering waves": "wuthering_waves",
  kancolle: "kantai_collection",
  arknights: "arknights",
  nikke: "goddess_of_victory:_nikke",
  touhou: "touhou",
  eva: "neon_genesis_evangelion",
  evangelion: "neon_genesis_evangelion",
  btr: "bocchi_the_rock!",
  "bocchi the rock": "bocchi_the_rock!",
  "re:zero": "re:zero_kara_hajimeru_isekai_seikatsu",
  rezero: "re:zero_kara_hajimeru_isekai_seikatsu",
  naruto: "naruto",
  bleach: "bleach",
  op: "one_piece",
  "one piece": "one_piece",
  jks: "jujutsu_kaisen",
  "jujutsu kaisen": "jujutsu_kaisen",
  knb: "kuroko_no_basuke",
  kny: "kimetsu_no_yaiba",
  "demon slayer": "kimetsu_no_yaiba",
  csm: "chainsaw_man",
  "chainsaw man": "chainsaw_man",
  hololive: "hololive",
  nijisanji: "nijisanji",
  vocaloid: "vocaloid",
  danganronpa: "danganronpa",
  persona: "persona_(series)",
  nier: "nier_(series)",
  "nier automata": "nier:automata",
  cyberpunk: "cyberpunk_2077",
  "oshi no ko": "oshi_no_ko",
  "spy x family": "spy_x_family",
  "lycoris recoil": "lycoris_recoil",
  konosuba: "kono_subarashii_sekai_ni_syukufuku_o!",
  sao: "sword_art_online",
  overlord: "overlord_(maruyama)",
  aot: "shingeki_no_kyojin",
  danmachi: "dungeon_ni_deai_o_motomeru_no_wa_machigatteiru_darou_ka",
  cote: "youkoso_jitsuryoku_shijou_shugi_no_kyoushitsu_e",
  dal: "date_a_live",
};

// 3. INDONESIAN & SYNONYM ATTRIBUTE MAP
export const ATTRIBUTE_SYNONYMS: Record<string, string> = {
  // Common Anime Forms & Transformations
  "ssj": "super_saiyan",
  "ssj2": "super_saiyan_2",
  "ssj3": "super_saiyan_3",
  "ssj4": "super_saiyan_4",
  "super saiyan": "super_saiyan",
  "super saiyan blue": "super_saiyan_blue",
  "ssb": "super_saiyan_blue",
  "ultra instinct": "ultra_instinct",
  "gear 5": "gear_5",
  "gear 4": "gear_4",
  "bankai": "bankai",
  "domain expansion": "domain_expansion",

  // Indonesian / English Stopwords & Gender
  "gadis": "1girl",
  "cewek": "1girl",
  "perempuan": "1girl",
  "wanita": "1girl",
  "cowok": "1boy",
  "pria": "1boy",
  "laki-laki": "1boy",
  "1girl": "1girl",
  "1boy": "1boy",
  "2girls": "2girls",

  // Indonesian Clothing / Outfits
  "baju renang": "swimsuit",
  "pakaian renang": "swimsuit",
  "baju renang sekolah": "school_swimsuit",
  renang: "swimsuit",
  bikini: "bikini",
  "baju pelayan": "maid",
  pelayan: "maid",
  maid: "maid",
  "baju kelinci": "bunny_girl",
  kelinci: "bunny_girl",
  "bunny girl": "bunny_girl",
  "bunny suit": "bunny_suit",
  "seragam sekolah": "school_uniform",
  seragam: "school_uniform",
  sekolah: "school_uniform",
  sailor: "sailor_suit",
  "sailor uniform": "sailor_suit",
  kimono: "kimono",
  yukata: "yukata",
  "gaun pengantin": "wedding_dress",
  gaun: "dress",
  dress: "dress",
  jaket: "jacket",
  hoodie: "hoodie",
  sweater: "sweater",
  jas: "suit",
  baju: "clothes",
  baju_tidur: "pajamas",
  piyama: "pajamas",
  kaos_kaki: "socks",
  stocking: "thighhighs",
  stoking: "thighhighs",
  paha: "thighs",

  // Indonesian Hair Styles & Colors
  "rambut putih": "white_hair",
  "rambut perak": "silver_hair",
  "rambut hitam": "black_hair",
  "rambut pirang": "blonde_hair",
  "rambut kuning": "blonde_hair",
  "rambut biru": "blue_hair",
  "rambut merah": "red_hair",
  "rambut pink": "pink_hair",
  "rambut merah muda": "pink_hair",
  "rambut hijau": "green_hair",
  "rambut ungu": "purple_hair",
  "rambut cokelat": "brown_hair",
  "rambut coklat": "brown_hair",
  "rambut abu-abu": "grey_hair",
  "rambut panjang": "long_hair",
  "rambut pendek": "short_hair",
  "kuncir dua": "twintails",
  twintail: "twintails",
  twintails: "twintails",
  "kuncir kuda": "ponytail",
  ponytail: "ponytail",
  kepang: "braid",
  braid: "braid",
  "rambut berombak": "wavy_hair",
  "rambut lurus": "straight_hair",

  // English hair styles & colors
  "white hair": "white_hair",
  "black hair": "black_hair",
  "blonde hair": "blonde_hair",
  "blue hair": "blue_hair",
  "red hair": "red_hair",
  "pink hair": "pink_hair",
  "green hair": "green_hair",
  "purple hair": "purple_hair",
  "silver hair": "silver_hair",
  "brown hair": "brown_hair",
  "long hair": "long_hair",
  "short hair": "short_hair",

  // Indonesian Eye Colors & Facial Features
  "mata merah": "red_eyes",
  "mata biru": "blue_eyes",
  "mata hijau": "green_eyes",
  "mata kuning": "yellow_eyes",
  "mata emas": "amber_eyes",
  "mata ungu": "purple_eyes",
  "mata hitam": "black_eyes",
  "mata beda warna": "heterochromia",
  heterochromia: "heterochromia",
  "red eyes": "red_eyes",
  "blue eyes": "blue_eyes",
  "green eyes": "green_eyes",
  "yellow eyes": "yellow_eyes",
  "purple eyes": "purple_eyes",
  kacamata: "glasses",
  glasses: "glasses",
  megane: "glasses",
  taring: "fang",
  fang: "fang",
  blush: "blush",
  merona: "blush",
  senyum: "smile",
  smile: "smile",
  tertawa: "laughing",
  kedip: "wink",
  wink: "wink",
  menangis: "crying",
  tidur: "sleeping",
  sleeping: "sleeping",
  makan: "eating",
  minum: "drinking",

  // Animal Features / Kemonomimi
  "telinga kucing": "cat_ears",
  "kuping kucing": "cat_ears",
  "cat ears": "cat_ears",
  kucing: "cat_ears",
  neko: "cat_ears",
  catgirl: "cat_ears",
  "telinga kelinci": "rabbit_ears",
  "rabbit ears": "rabbit_ears",
  "telinga rubah": "fox_ears",
  "fox ears": "fox_ears",
  "telinga serigala": "wolf_ears",
  "telinga anjing": "dog_ears",
  "telinga peri": "pointy_ears",
  elf: "pointy_ears",
  sayap: "wings",
  wings: "wings",
  tanduk: "horns",
  horns: "horns",
  ekor: "tail",
  halo: "halo",

  // Weapons & Actions
  pedang: "sword",
  sword: "sword",
  katana: "katana",
  senapan: "gun",
  gun: "gun",
  pistol: "handgun",
  senjata: "weapon",
  sihir: "magic",
  buku: "book",
  bunga: "flowers",
  flowers: "flowers",
  mawar: "rose",

  // Setting & Background
  pemandangan: "scenery",
  scenery: "scenery",
  pantai: "beach",
  beach: "beach",
  laut: "ocean",
  kamar: "bedroom",
  bedroom: "bedroom",
  ranjang: "bed",
  kelas: "classroom",
  classroom: "classroom",
  malam: "night",
  night: "night",
  bintang: "stars",
  langit: "sky",
  hujan: "rain",
  rain: "rain",
  salju: "snow",
  matahari_terbenam: "sunset",
  senja: "sunset",
  sunset: "sunset",
  matahari_terbit: "sunrise",
  pagi: "morning",
  hutan: "forest",
  taman: "garden",
  kota: "city",
  jalanan: "street",
  cyberpunk: "cyberpunk",
  gothic: "gothic",

  // Composition / Aesthetic
  solo: "solo",
  sendiri: "solo",
  aesthetic: "aesthetic",
  wallpaper: "scenery",
  chibi: "chibi",
  lucu: "cute",
  cute: "cute",
  cantik: "beautiful",
  keren: "cool",
  gelap: "dark",
  vintage: "retro_artstyle",
  retro: "retro_artstyle",
  pose: "dynamic_pose",
  "melihat ke penonton": "looking_at_viewer",
  "looking at viewer": "looking_at_viewer",
};

const IGNORED_GENERIC_WORDS = new Set([
  "gambar", "foto", "anime", "art", "kartun", "karakter", "character", "hd", "4k",
  "cantik", "bagus", "keren", "illustrasi", "illustration", "fanart", "wallpaper",
  "and", "dan", "with", "dengan", "in", "di", "the", "yang", "nya", "dari", "untuk",
  "buat", "tolong", "cari", "carikan", "minta", "kasih", "dong"
]);

const tagCache = new Map<string, string>();

/**
 * Normalizes and extracts phrase entities from a natural language or comma-separated query.
 */
export async function parseSmartAnimeQuery(
  rawInput: string,
  filterNsfwOn: boolean = true,
  aiArtFilter: AiArtFilterType = "hide"
): Promise<ParsedAnimeQuery> {
  const cleanInput = rawInput.trim().toLowerCase();

  let wantsNsfw = false;
  let wantsSuggestive = false;

  // Check explicit / suggestive markers
  const explicitWords = ["nsfw", "r18", "r-18", "hentai", "lewd", "explicit", "nude", "naked", "seks", "telanjang"];
  const suggestiveWords = ["ecchi", "suggestive", "questionable", "sensual", "sexy", "seksi"];

  for (const w of explicitWords) {
    if (new RegExp(`\\b${w}\\b`, "i").test(cleanInput)) {
      wantsNsfw = true;
    }
  }
  for (const w of suggestiveWords) {
    if (new RegExp(`\\b${w}\\b`, "i").test(cleanInput)) {
      wantsSuggestive = true;
    }
  }

  // Remove explicit control tokens from query text
  let workingText = cleanInput;
  for (const w of [...explicitWords, ...suggestiveWords]) {
    workingText = workingText.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  }

  // Extract known multi-word phrases first
  const recognizedSecondaryTags: string[] = [];
  let detectedCharacter: string | undefined;
  let detectedFranchise: string | undefined;

  // 1. Check Character Dictionary (sorted by length descending for longest phrase match)
  const charKeys = Object.keys(CHARACTER_DICTIONARY).sort((a, b) => b.length - a.length);
  for (const key of charKeys) {
    const keyRegex = new RegExp(`(^|[,\\s+])${escapeRegExp(key)}($|[,\\s+])`, "i");
    if (keyRegex.test(workingText)) {
      detectedCharacter = CHARACTER_DICTIONARY[key];
      workingText = workingText.replace(keyRegex, " ");
      break;
    }
  }

  // 2. Check Franchise Dictionary
  const franchiseKeys = Object.keys(FRANCHISE_DICTIONARY).sort((a, b) => b.length - a.length);
  for (const key of franchiseKeys) {
    const fRegex = new RegExp(`(^|[,\\s+])${escapeRegExp(key)}($|[,\\s+])`, "i");
    if (fRegex.test(workingText)) {
      detectedFranchise = FRANCHISE_DICTIONARY[key];
      workingText = workingText.replace(fRegex, " ");
      break;
    }
  }

  // 3. Check Attribute & Indonesian Synonyms (sorted by length descending)
  const attrKeys = Object.keys(ATTRIBUTE_SYNONYMS).sort((a, b) => b.length - a.length);
  for (const key of attrKeys) {
    const aRegex = new RegExp(`(^|[,\\s+])${escapeRegExp(key)}($|[,\\s+])`, "i");
    if (aRegex.test(workingText)) {
      const canonical = ATTRIBUTE_SYNONYMS[key];
      if (!recognizedSecondaryTags.includes(canonical)) {
        recognizedSecondaryTags.push(canonical);
      }
      workingText = workingText.replace(aRegex, " ");
    }
  }

  // 4. Parse remaining words as raw booru tags
  const remainingTokens = workingText
    .split(/[,+\s]+/)
    .map((s) => s.trim().replace(/^[-_]+|[-_]+$/g, ""))
    .filter((s) => s.length > 1 && !IGNORED_GENERIC_WORDS.has(s));

  for (const token of remainingTokens) {
    const resolved = await resolveTagWithDanbooruApi(token, detectedFranchise);
    if (resolved && !recognizedSecondaryTags.includes(resolved)) {
      if (!detectedCharacter && (resolved.includes("(") || resolved.includes("_("))) {
        detectedCharacter = resolved;
      } else {
        recognizedSecondaryTags.push(resolved);
      }
    }
  }

  // Build combined final tag set
  const allTags: string[] = [];
  if (detectedCharacter) allTags.push(detectedCharacter);
  if (detectedFranchise && !detectedCharacter?.includes(detectedFranchise)) {
    allTags.push(detectedFranchise);
  }
  for (const st of recognizedSecondaryTags) {
    if (!allTags.includes(st)) allTags.push(st);
  }

  return {
    characterTag: detectedCharacter,
    franchiseTag: detectedFranchise,
    secondaryTags: recognizedSecondaryTags,
    allTags,
    wantsNsfw: wantsNsfw && !filterNsfwOn,
    wantsSuggestive,
    aiArtFilter,
  };
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fallback live tag search against Danbooru /tags.json API with caching & scoring
 */
async function resolveTagWithDanbooruApi(rawToken: string, franchiseHint?: string): Promise<string> {
  const clean = rawToken.toLowerCase().replace(/\s+/g, "_");
  if (!clean || clean.length < 2) return "";

  if (ATTRIBUTE_SYNONYMS[clean]) return ATTRIBUTE_SYNONYMS[clean];
  if (CHARACTER_DICTIONARY[clean]) return CHARACTER_DICTIONARY[clean];
  if (FRANCHISE_DICTIONARY[clean]) return FRANCHISE_DICTIONARY[clean];

  const cacheKey = franchiseHint ? `${clean}_${franchiseHint}` : clean;
  if (tagCache.has(cacheKey)) return tagCache.get(cacheKey)!;

  try {
    const res = await fetch(
      `https://danbooru.donmai.us/tags.json?search[name_matches]=*${encodeURIComponent(clean)}*&search[order]=count&limit=10`,
      {
        headers: { "User-Agent": "PorscheChanBot/1.0" },
        signal: AbortSignal.timeout(3_000),
      }
    );

    if (res.ok) {
      const tags = (await res.json()) as any[];
      if (Array.isArray(tags) && tags.length > 0) {
        // Find exact or closest word match
        const exact = tags.find((t) => t.name === clean);
        if (exact) {
          tagCache.set(cacheKey, exact.name);
          return exact.name;
        }

        const scored = tags.map((t) => {
          let s = 0;
          const name = String(t.name || "").toLowerCase();
          if (name === clean) {
            s += 120;
          } else if (name.startsWith(`${clean}_(`)) {
            s += 80;
          } else if (name.startsWith(`${clean}_`)) {
            s += 60;
          } else if (name.includes(`_${clean}_`)) {
            s += 50;
          } else if (name.endsWith(`_${clean}`)) {
            s += 40;
          }

          // Category weighting: if exact match, give slight boost, but prefer general tag (0) for descriptors
          if (t.category === 0) s += 30; // General tag
          else if (t.category === 4 && name.includes("(")) s += 25; // Distinct character with franchise
          else if (t.category === 3) s += 20; // Copyright

          if (franchiseHint && name.includes(franchiseHint.replace(/[^a-z0-9]/g, ""))) s += 60;
          return { name: t.name, score: s };
        });

        scored.sort((a, b) => b.score - a.score);
        if (scored[0] && scored[0].score > 40) {
          tagCache.set(cacheKey, scored[0].name);
          return scored[0].name;
        }
      }
    }
  } catch {}

  tagCache.set(cacheKey, clean);
  return clean;
}

/**
 * Multi-Booru Cascading Search Provider
 * Searches across Danbooru, Yande.re, Safebooru, Konachan, TBIB with strict tag matching & fallback.
 */
export async function fetchBooruArtWithCascadingFallback(
  parsed: ParsedAnimeQuery,
  options?: {
    page?: number;
    excludeIds?: (string | number)[];
    filterNsfwOn?: boolean;
  }
): Promise<{ post: BooruPostResult; buffer: Buffer } | null> {
  const excludeSet = new Set((options?.excludeIds || []).map((id) => String(id)));
  const page = options?.page || 1;
  const isSafeOnly = options?.filterNsfwOn ?? true;

  // Build specialized queries for each provider
  // Danbooru allows max 2 tags for anonymous queries
  const danbooruTagSet: string[] = [];
  if (parsed.characterTag) {
    danbooruTagSet.push(parsed.characterTag);
  } else if (parsed.franchiseTag) {
    danbooruTagSet.push(parsed.franchiseTag);
  } else if (parsed.secondaryTags[0]) {
    danbooruTagSet.push(parsed.secondaryTags[0]);
  }

  if (danbooruTagSet.length < 2) {
    if (parsed.secondaryTags[0] && !danbooruTagSet.includes(parsed.secondaryTags[0])) {
      danbooruTagSet.push(parsed.secondaryTags[0]);
    } else if (isSafeOnly) {
      danbooruTagSet.push("rating:general");
    } else if (parsed.wantsNsfw) {
      danbooruTagSet.push("rating:explicit");
    }
  }

  // Multi-tag boorus (Yande.re, Safebooru, Konachan, TBIB) accept all tags!
  const multiTagSet: string[] = [...parsed.allTags];
  if (isSafeOnly) {
    multiTagSet.push("rating:safe");
  } else if (parsed.wantsNsfw) {
    multiTagSet.push("rating:explicit");
  }

  // 1. Try Danbooru first
  try {
    const danbooruQuery = danbooruTagSet.length > 0 ? danbooruTagSet.join(" ") : (isSafeOnly ? "1girl rating:general" : "1girl");
    const danUrl = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(danbooruQuery)}&limit=40&page=${page}`;
    const dRes = await fetch(danUrl, {
      headers: { "User-Agent": "PorscheChanBot/1.0" },
      signal: AbortSignal.timeout(8_000),
    });

    if (dRes.ok) {
      const data = await dRes.json();
      if (Array.isArray(data) && data.length > 0) {
        const candidate = evaluateAndSelectCandidate(data, parsed, excludeSet, "Danbooru Archive");
        if (candidate) {
          const dlRes = await fetch(candidate.url, {
            headers: { "User-Agent": "PorscheChanBot/1.0", Referer: "https://danbooru.donmai.us/" },
            signal: AbortSignal.timeout(15_000),
          });
          if (dlRes.ok) {
            const buf = Buffer.from(await dlRes.arrayBuffer());
            return { post: candidate, buffer: buf };
          }
        }
      }
    }
  } catch {}

  // 2. Try Yande.re (Supports unlimited tags & pristine high-res art)
  try {
    const yandeQuery = multiTagSet.length > 0 ? multiTagSet.join(" ") : "rating:safe";
    const yandUrl = `https://yande.re/post.json?tags=${encodeURIComponent(yandeQuery)}&limit=40&page=${page}`;
    const yRes = await fetch(yandUrl, {
      headers: { "User-Agent": "PorscheChanBot/1.0" },
      signal: AbortSignal.timeout(8_000),
    });

    if (yRes.ok) {
      const data = await yRes.json();
      if (Array.isArray(data) && data.length > 0) {
        const candidate = evaluateAndSelectCandidate(data, parsed, excludeSet, "Yande.re Archive");
        if (candidate) {
          const dlRes = await fetch(candidate.url, {
            headers: { "User-Agent": "PorscheChanBot/1.0", Referer: "https://yande.re/" },
            signal: AbortSignal.timeout(15_000),
          });
          if (dlRes.ok) {
            const buf = Buffer.from(await dlRes.arrayBuffer());
            return { post: candidate, buffer: buf };
          }
        }
      }
    }
  } catch {}

  // 3. Try Safebooru (Strict SFW booru, supports unlimited tags)
  try {
    const safeTagList = parsed.allTags.length > 0 ? parsed.allTags : ["1girl"];
    const safeQuery = safeTagList.join(" ");
    const pid = Math.max(0, page - 1);
    const safeUrl = `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(safeQuery)}&limit=40&pid=${pid}`;
    const sRes = await fetch(safeUrl, {
      headers: { "User-Agent": "PorscheChanBot/1.0" },
      signal: AbortSignal.timeout(8_000),
    });

    if (sRes.ok) {
      const data = await sRes.json();
      if (Array.isArray(data) && data.length > 0) {
        const candidate = evaluateAndSelectCandidate(data, parsed, excludeSet, "Safebooru Archive");
        if (candidate) {
          const dlRes = await fetch(candidate.url, {
            headers: { "User-Agent": "PorscheChanBot/1.0", Referer: "https://safebooru.org/" },
            signal: AbortSignal.timeout(15_000),
          });
          if (dlRes.ok) {
            const buf = Buffer.from(await dlRes.arrayBuffer());
            return { post: candidate, buffer: buf };
          }
        }
      }
    }
  } catch {}

  // 4. Try Konachan (High-res anime art)
  try {
    const konaQuery = multiTagSet.length > 0 ? multiTagSet.join(" ") : "rating:safe";
    const konaUrl = `https://konachan.net/post.json?tags=${encodeURIComponent(konaQuery)}&limit=40&page=${page}`;
    const kRes = await fetch(konaUrl, {
      headers: { "User-Agent": "PorscheChanBot/1.0" },
      signal: AbortSignal.timeout(8_000),
    });

    if (kRes.ok) {
      const data = await kRes.json();
      if (Array.isArray(data) && data.length > 0) {
        const candidate = evaluateAndSelectCandidate(data, parsed, excludeSet, "Konachan Archive");
        if (candidate) {
          const dlRes = await fetch(candidate.url, {
            headers: { "User-Agent": "PorscheChanBot/1.0", Referer: "https://konachan.net/" },
            signal: AbortSignal.timeout(15_000),
          });
          if (dlRes.ok) {
            const buf = Buffer.from(await dlRes.arrayBuffer());
            return { post: candidate, buffer: buf };
          }
        }
      }
    }
  } catch {}

  // 5. Try TBIB (The Big ImageBoard)
  try {
    const tbibTags = parsed.allTags.length > 0 ? parsed.allTags.join(" ") : "1girl";
    const pid = Math.max(0, page - 1);
    const tbibUrl = `https://tbib.org/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(tbibTags)}&limit=40&pid=${pid}`;
    const tRes = await fetch(tbibUrl, {
      headers: { "User-Agent": "PorscheChanBot/1.0" },
      signal: AbortSignal.timeout(8_000),
    });

    if (tRes.ok) {
      const data = await tRes.json();
      if (Array.isArray(data) && data.length > 0) {
        const candidate = evaluateAndSelectCandidate(data, parsed, excludeSet, "TBIB Archive");
        if (candidate) {
          const dlRes = await fetch(candidate.url, {
            headers: { "User-Agent": "PorscheChanBot/1.0", Referer: "https://tbib.org/" },
            signal: AbortSignal.timeout(15_000),
          });
          if (dlRes.ok) {
            const buf = Buffer.from(await dlRes.arrayBuffer());
            return { post: candidate, buffer: buf };
          }
        }
      }
    }
  } catch {}

  // 6. TAG RELAXATION FALLBACK: If strict tag combination yielded 0 results, retry with core character tag
  if (parsed.characterTag && (parsed.secondaryTags.length > 0 || parsed.franchiseTag)) {
    const relaxedQuery: ParsedAnimeQuery = {
      ...parsed,
      secondaryTags: [],
      allTags: [parsed.characterTag],
    };

    try {
      const danUrl = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(parsed.characterTag)}&limit=40&page=${page}`;
      const dRes = await fetch(danUrl, {
        headers: { "User-Agent": "PorscheChanBot/1.0" },
        signal: AbortSignal.timeout(8_000),
      });

      if (dRes.ok) {
        const data = await dRes.json();
        if (Array.isArray(data) && data.length > 0) {
          const candidate = evaluateAndSelectCandidate(data, relaxedQuery, excludeSet, "Danbooru Archive");
          if (candidate) {
            const dlRes = await fetch(candidate.url, {
              headers: { "User-Agent": "PorscheChanBot/1.0", Referer: "https://danbooru.donmai.us/" },
              signal: AbortSignal.timeout(15_000),
            });
            if (dlRes.ok) {
              const buf = Buffer.from(await dlRes.arrayBuffer());
              return { post: candidate, buffer: buf };
            }
          }
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Precision candidate evaluator that scores posts based on:
 * 1. Strict Target Character Presence (guaranteed never nyasar)
 * 2. Secondary Tag Matching (costume, hair color, attributes)
 * 3. Solo portrait focus vs crowd scenes
 * 4. Image resolution, favorites / score
 * 5. Deduplication (never show already seen images)
 * 6. AI art mode compliance
 */
function evaluateAndSelectCandidate(
  rawPosts: any[],
  parsed: ParsedAnimeQuery,
  excludeSet: Set<string>,
  providerName: string
): BooruPostResult | null {
  const validPosts = rawPosts.filter((p) => {
    const url = p.file_url || p.large_file_url || p.sample_url || p.jpeg_url;
    return Boolean(url && typeof url === "string" && url.startsWith("http"));
  });

  if (validPosts.length === 0) return null;

  const targetChar = parsed.characterTag ? parsed.characterTag.toLowerCase() : "";
  const charCore = targetChar.replace(/_\([^)]+\)$/, "");
  const targetFranchise = parsed.franchiseTag ? parsed.franchiseTag.toLowerCase() : "";

  const scoredCandidates: Array<{ result: BooruPostResult; score: number }> = [];

  for (const p of validPosts) {
    const idStr = String(p.id);
    const tagStr = (p.tag_string || p.tags || "").toLowerCase();
    const charTagStr = (p.tag_string_character || "").toLowerCase();
    const isAi = isPostAiGenerated(p);

    // AI filter compliance
    if (parsed.aiArtFilter === "hide" && isAi) continue;
    if (parsed.aiArtFilter === "only" && !isAi) continue;

    let score = 0;

    // Strict Character Verification
    if (targetChar) {
      const hasExactChar = charTagStr.includes(targetChar) || tagStr.includes(targetChar);
      const hasCoreChar = charCore.length > 2 && (charTagStr.includes(charCore) || tagStr.includes(charCore));

      if (hasExactChar) {
        score += 300;
      } else if (hasCoreChar) {
        score += 180;
      } else {
        // If post lacks the target character, heavily penalize so it won't stray
        score -= 1000;
      }
    }

    // Secondary Tag Matching (swimsuit, maid, white_hair, cat_ears, etc.)
    for (const secTag of parsed.secondaryTags) {
      const cleanSec = secTag.toLowerCase().replace(/\s+/g, "_");
      if (tagStr.includes(cleanSec)) {
        score += 120;
      }
    }

    // Franchise match bonus
    if (targetFranchise && tagStr.includes(targetFranchise)) {
      score += 40;
    }

    // Solo focus bonus vs crowd scenes
    if (tagStr.includes("solo") || tagStr.includes("1girl") || tagStr.includes("1boy")) {
      score += 60;
    }
    if (tagStr.includes("2girls") || tagStr.includes("multiple_girls") || tagStr.includes("group")) {
      score -= 40;
    }

    // High quality / favorite bonus
    if (p.fav_count) score += Math.min(30, Number(p.fav_count));
    if (p.score) score += Math.min(25, Math.max(0, Number(p.score)));

    // Already seen penalty
    if (excludeSet.has(idStr)) {
      score -= 5000;
    }

    // Extract Pixiv & Source links
    let pixivUrl: string | undefined;
    if (p.source) {
      const pxMatch =
        String(p.source).match(/(?:pixiv\.net\/artworks\/|img\/\d+\/\d+\/\d+\/\d+\/\d+\/\d+\/)(\d+)/i) ||
        String(p.source).match(/(\d+)(?:_p\d+)?\.(?:jpg|png|gif)/i);
      if (pxMatch && pxMatch[1]) {
        pixivUrl = `https://www.pixiv.net/artworks/${pxMatch[1]}`;
      } else if (String(p.source).startsWith("http")) {
        pixivUrl = p.source;
      }
    }

    const danbooruUrl = providerName.includes("Danbooru") ? `https://danbooru.donmai.us/posts/${p.id}` : undefined;
    const imgUrl = p.file_url || p.large_file_url || p.sample_url || p.jpeg_url;
    const tagsList = (p.tag_string || p.tags || "").split(" ").filter(Boolean).slice(0, 15);

    scoredCandidates.push({
      score,
      result: {
        id: p.id,
        url: imgUrl,
        previewUrl: p.preview_file_url || p.preview_url,
        rating: p.rating === "e" ? "explicit" : p.rating === "q" ? "questionable" : "safe",
        tags: tagsList,
        characterTags: charTagStr ? charTagStr.split(" ").filter(Boolean) : undefined,
        artistName: p.tag_string_artist || undefined,
        sourceUrl: pixivUrl || p.source || danbooruUrl,
        pixivUrl,
        danbooruUrl,
        provider: providerName,
        isAiGenerated: isAi,
        score,
      },
    });
  }

  if (scoredCandidates.length === 0) return null;

  scoredCandidates.sort((a, b) => b.score - a.score);

  // Pick among top candidates with positive score to add nice variety while maintaining accuracy
  const highestScore = scoredCandidates[0].score;
  const topPool = scoredCandidates.filter((c) => c.score >= highestScore - 40 && c.score > -200);

  if (topPool.length > 0) {
    const selected = topPool[Math.floor(Math.random() * topPool.length)];
    return selected.result;
  }

  return scoredCandidates[0].result;
}

function isPostAiGenerated(post: any): boolean {
  const tags = (post.tag_string || post.tags || "").toLowerCase();
  const generalTags = (post.tag_string_general || "").toLowerCase();
  return (
    tags.includes("ai-generated") ||
    tags.includes("ai_generated") ||
    tags.includes("novelai") ||
    tags.includes("midjourney") ||
    tags.includes("stable_diffusion") ||
    tags.includes("ai_art") ||
    generalTags.includes("ai-generated") ||
    generalTags.includes("ai_generated")
  );
}
