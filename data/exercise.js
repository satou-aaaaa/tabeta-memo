// 運動の種類とメッツ。厚生労働省「生活活動のメッツ表」「運動のメッツ表」（2026年1月版。国立健康・栄養研究所
// 改訂版「身体活動のメッツ（METs）表」より改変）の値をそのまま写したもの。
// https://kennet.mhlw.go.jp/tools/pdf/mets.pdf
// 使うエネルギー（安静時の分を引く）= (メッツ − 1) × 時間 × 体重 で計算する（src/app.js）。
window.EXERCISES_SOURCE = { label: "厚生労働省「生活活動のメッツ表」「運動のメッツ表」（2026年1月版）", url: "https://kennet.mhlw.go.jp/tools/pdf/mets.pdf" };
window.EXERCISES = [
  { id: "walk", label: "ふつうに歩く（分速67m）", mets: 3.0 },
  { id: "walk2", label: "散歩・ほどほどの速さで歩く（分速75〜85m）", mets: 3.5 },
  { id: "brisk", label: "やや速歩（分速93m）", mets: 4.3 },
  { id: "brisk2", label: "かなり速歩（分速107m）", mets: 5.0 },
  { id: "stairs", label: "階段を上る（ゆっくり）", mets: 4.0 },
  { id: "bike", label: "自転車（時速16km 未満・通勤）", mets: 4.0 },
  { id: "cycling", label: "サイクリング（時速20km くらい）", mets: 8.0 },
  { id: "jog0", label: "ゆっくりとしたジョギング", mets: 6.0 },
  { id: "jog", label: "ジョギング", mets: 7.0 },
  { id: "run", label: "ランニング（分速134m）", mets: 8.3 },
  { id: "stretch", label: "ストレッチング", mets: 2.3 },
  { id: "yoga", label: "ヨガ", mets: 2.5 },
  { id: "pilates", label: "ピラティス・太極拳", mets: 3.0 },
  { id: "radio", label: "ラジオ体操第1", mets: 4.0 },
  { id: "muscle", label: "筋トレ（ほどほど：腕立て伏せ・腹筋）", mets: 3.8 },
  { id: "squat", label: "筋トレ（スクワット）", mets: 5.0 },
  { id: "muscle2", label: "筋トレ（激しい：腕立て伏せ・腹筋）", mets: 8.0 },
  { id: "ergo", label: "エアロバイク（30〜50ワット）", mets: 3.5 },
  { id: "aerobics", label: "エアロビクス", mets: 7.3 },
  { id: "dance", label: "社交ダンス", mets: 3.0 },
  { id: "aquawalk", label: "水中歩行（中等度）", mets: 4.5 },
  { id: "swim", label: "水泳（のんびり泳ぐ）", mets: 6.0 },
  { id: "crawl", label: "水泳（クロール・ふつうの速さ）", mets: 8.3 },
  { id: "tennis2", label: "テニス（ダブルス）", mets: 4.5 },
  { id: "tennis1", label: "テニス（シングルス）", mets: 7.3 },
  { id: "badminton", label: "バドミントン", mets: 5.5 },
  { id: "tabletennis", label: "卓球", mets: 4.0 },
  { id: "golf", label: "ゴルフ（手引きカート）", mets: 3.5 },
  { id: "hike", label: "山を登る（軽い荷物）", mets: 6.5 },
  { id: "clean", label: "掃除機・床掃除", mets: 3.3 },
  { id: "kids", label: "子どもと遊ぶ（歩く・走る、活発に）", mets: 5.8 },
];
