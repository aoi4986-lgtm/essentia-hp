"""
Essentia株式会社 ホームページ + AIチャットボット サーバー
Flask で静的ファイルを配信しつつ、/api/chat エンドポイントで
Claude API へのリクエストを中継する（APIキーをフロントに露出させない）。
"""

import os
import json
import anthropic
from flask import Flask, request, Response, send_from_directory
from dotenv import load_dotenv

# server.py と同じディレクトリの .env を明示的に読み込む（既存の環境変数を上書き）
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
load_dotenv(_env_path, override=True)

# Flask アプリケーション初期化（静的ファイルのルートをプロジェクト直下に設定）
app = Flask(__name__, static_folder='.', static_url_path='')

# Anthropic クライアント初期化
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# チャットボットのシステムプロンプト
SYSTEM_PROMPT = """あなたはEssentia株式会社の公式AIアシスタントです。
以下の自社情報をもとに、丁寧で親しみやすい口調でお客様のご相談に対応してください。

━━━━━━━━━━━━━━━━━━━━━━━━
【会社概要】
━━━━━━━━━━━━━━━━━━━━━━━━
Essentia株式会社は「つなぐ技術、ささえる心。」をモットーに、
OA機器販売・高齢者施設紹介・医療介護コンサルティングの3事業を展開しています。

━━━━━━━━━━━━━━━━━━━━━━━━
【サービス1：OA機器販売サービス】
━━━━━━━━━━━━━━━━━━━━━━━━
法人・事業所向けに、コピー機・複合機・プリンター・ビジネスフォン・パソコン・
ネットワーク機器などのOA機器の販売、リース、設置、保守サポートを行っています。

お客様の業務環境や利用状況をヒアリングし、コスト削減・業務効率化・
セキュリティ向上につながる最適な機器やプランをご提案します。
導入後のトラブル対応、消耗品の手配、機器の入れ替え相談など、
継続的なアフターサポートも充実しています。

【料金】
機器の種類や導入規模によって異なります。まずはお気軽にご相談ください。
お客様のご要望に合わせて、お見積もりをご提示いたします。

━━━━━━━━━━━━━━━━━━━━━━━━
【サービス2：高齢者施設紹介業】
━━━━━━━━━━━━━━━━━━━━━━━━
有料老人ホーム、サービス付き高齢者向け住宅（サ高住）、グループホーム、
特別養護老人ホーム、介護老人保健施設など、高齢者向け施設への入居相談・
施設紹介を行っています。

ご本人やご家族の状況、介護度、医療対応の必要性、ご予算、
希望エリア、生活スタイルなどを確認したうえで、条件に合う施設をご提案します。
施設見学の調整、入居までの流れの説明、必要書類や費用面のご相談など、
入居前の不安を和らげるサポートを行っています。

【料金】
完全無料でご利用いただけます。ご家族の方のご相談もお気軽にどうぞ。

━━━━━━━━━━━━━━━━━━━━━━━━
【サービス3：医療・介護コンサルティング】
━━━━━━━━━━━━━━━━━━━━━━━━
クリニック、訪問診療、訪問看護ステーション、医療法人、介護施設、
居宅介護支援事業所、訪問介護事業所など、医療・介護に関連する事業者向けに
経営・運営支援を行っています。

主な支援内容：
・医療機関の開業・分院展開支援
・訪問診療・訪問看護の立ち上げ支援
・事業計画作成・収支改善
・営業・集患支援
・採用・教育体制づくり
・行政手続き・指定申請サポート
・加算・報酬制度に関する相談
・業務フロー改善

売上向上、利益改善、患者・利用者獲得、スタッフ定着、業務効率化など、
現場課題に寄り添った具体的な提案を行います。

【料金】
支援内容によって異なります。まずはお電話でお気軽にご連絡ください。
→ 06-7172-5657

━━━━━━━━━━━━━━━━━━━━━━━━
【営業時間・連絡先】
━━━━━━━━━━━━━━━━━━━━━━━━
営業時間：平日 9:00〜18:00
電話番号：06-7172-5657
メール　：matsumoto@essentia-inc.co.jp

━━━━━━━━━━━━━━━━━━━━━━━━
【対応ルール】
━━━━━━━━━━━━━━━━━━━━━━━━
・ユーザーのメッセージ先頭に [ユーザーは【○○】について相談しています] という指定がある場合は、
　そのサービスの情報のみに絞って回答してください。他のサービスの情報は出さないでください。
・回答は簡潔に、200〜300文字を目安にしてください。
・専門用語は使いすぎず、初めてのお客様にも分かりやすい言葉で伝えてください。
・料金の詳細を聞かれた場合は「お見積もりが必要です」「まずはご連絡ください」と案内し、連絡先を添えてください。
・3事業の範囲外のご質問には「専門外のため、詳しくはお問い合わせください（06-7172-5657）」と案内してください。
・高齢者施設の相談では、ご本人・ご家族の気持ちに寄り添い、無理な提案はせず中立的に対応してください。
・メッセージ先頭の [〜について相談しています] というコンテキスト指定はユーザーには見せず、
　自然な会話として回答してください。"""


@app.route('/')
def index():
    """ホームページのルートを返す"""
    return send_from_directory('.', 'index.html')


@app.route('/api/chat', methods=['POST'])
def chat():
    """
    Claude API へリクエストを中継するエンドポイント。
    SSE（Server-Sent Events）でストリーミングレスポンスを返す。
    """
    data = request.get_json()
    if not data or 'messages' not in data:
        return {'error': 'messages が必要です'}, 400

    messages = data['messages']

    def generate():
        """ストリーミングレスポンスを生成するジェネレーター"""
        try:
            with client.messages.stream(
                model="claude-opus-4-7",
                max_tokens=512,
                system=SYSTEM_PROMPT,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    # SSE フォーマットで送信
                    payload = json.dumps({"text": text}, ensure_ascii=False)
                    yield f"data: {payload}\n\n"

            # 完了シグナル送信
            yield "data: [DONE]\n\n"

        except anthropic.AuthenticationError:
            error_payload = json.dumps({"error": "APIキーが無効です。.envファイルを確認してください。"}, ensure_ascii=False)
            yield f"data: {error_payload}\n\n"
        except Exception as e:
            error_payload = json.dumps({"error": f"エラーが発生しました: {str(e)}"}, ensure_ascii=False)
            yield f"data: {error_payload}\n\n"

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Access-Control-Allow-Origin': '*',
        }
    )


@app.route('/api/chat', methods=['OPTIONS'])
def chat_options():
    """CORS プリフライトリクエスト対応"""
    return Response(
        headers={
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }
    )


if __name__ == '__main__':
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key or api_key == "your-api-key-here":
        print("=" * 60)
        print("⚠️  警告: ANTHROPIC_API_KEY が設定されていません。")
        print("   .env ファイルにAPIキーを設定してください。")
        print("   取得先: https://console.anthropic.com/")
        print("=" * 60)

    print("🚀 Essentia チャットボットサーバーを起動します...")
    print("   URL: http://localhost:3000")
    app.run(host='0.0.0.0', port=3000, debug=False)
