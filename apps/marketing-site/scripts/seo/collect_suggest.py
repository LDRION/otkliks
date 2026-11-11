import json, time, urllib.parse, urllib.request
SEEDS = """автоотклик
автоотклики hh
бот для откликов hh
автоматические отклики на вакансии
массовые отклики hh
как откликаться на вакансии
отклик на вакансию
сопроводительное письмо
сопроводительное письмо hh
сопроводительное письмо к резюме пример
сопроводительное письмо нейросеть
сопроводительное письмо без опыта
сопроводительное письмо программист
не могу найти работу
не могу найти работу что делать
почему не могу найти работу
как найти работу
как быстро найти работу
как найти работу без опыта
почему не приглашают на собеседование
не отвечают на отклики
не отвечают на отклики hh
работодатель не отвечает
отказ hh
сколько откликов
вопросы работодателя hh
анкета работодателя
тестовое задание при приеме на работу
нейросеть для поиска работы
ии для поиска работы
chatgpt поиск работы
чат бот hh
hh ru резюме
резюме не смотрят
долгий поиск работы
выгорание от поиска работы
поиск работы психолог
поиск работы 2026
поиск работы программистом
найти работу в it""".split("\n")
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8", "replace"))
out = {}
for s in SEEDS:
    q = urllib.parse.quote(s)
    got = set()
    for url in (f"https://suggest.yandex.ru/suggest-ff.cgi?part={q}&uil=ru",
                f"https://suggestqueries.google.com/complete/search?client=firefox&hl=ru&gl=ru&q={q}"):
        try:
            got.update(get(url)[1])
        except Exception as e:
            print("ERR", s, e)
        time.sleep(0.4)
    out[s] = sorted(got)
json.dump(out, open(__import__("os").path.join(__import__("os").path.dirname(__file__), "suggest-out.json"), "w"), ensure_ascii=False, indent=1)
allq = sorted({x for v in out.values() for x in v})
print(len(allq), "уникальных запросов")
