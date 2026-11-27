"""Atualiza o índice de identificação do ramal usando a operação listar do IXC."""
import base64
import fcntl
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from urllib.request import Request, urlopen

CREDS = Path("/etc/dokploy/pbx-validation/private/ixc-contacts.json")
INDEX = Path("/etc/dokploy/pbx-validation/data/app/ixc-contacts.sqlite")
PAGE_SIZE = 300


def phones(value):
    for raw in re.split(r"[/;|,\n]", str(value or "")):
        digits = re.sub(r"\D", "", raw)
        if len(digits) in (12, 13) and digits.startswith("55"):
            digits = digits[2:]
        if len(digits) in (11, 12) and digits.startswith("0"):
            digits = digits[1:]
        if re.fullmatch(r"[1-9]\d[2-9]\d{7,8}", digits):
            yield digits


def sync(target, cfg):
    auth = base64.b64encode(cfg["ixc_api_token"].encode()).decode()
    url = cfg["ixc_api_url"].rstrip("/") + "/cliente"
    if not url.startswith("https://"):
        raise ValueError("O IXC precisa usar HTTPS")
    db = sqlite3.connect(target)
    try:
        db.execute("CREATE TEMP TABLE candidates (phone TEXT, person TEXT, client INTEGER, name TEXT, cpf TEXT, priority INTEGER)")
        db.execute("CREATE TABLE contacts (phone TEXT PRIMARY KEY, name TEXT NOT NULL, cpf TEXT NOT NULL) WITHOUT ROWID")
        seen = set()
        page = 1
        while True:
            query = dict(qtype="cliente.ativo", query="S", oper="=", page=str(page), rp=str(PAGE_SIZE), sortname="cliente.id", sortorder="asc")
            req = Request(url, data=json.dumps(query).encode(), headers={"Content-Type":"application/json", "ixcsoft":"listar", "Authorization":"Basic " + auth})
            with urlopen(req, timeout=30) as response:
                result = json.load(response)
            if page == 1:
                total = int(result["total"])
            rows = result["registros"]
            for row in rows:
                key = int(row["id"])
                if row.get("ativo") != "S" or key in seen:
                    raise ValueError("A consulta mudou durante a leitura")
                seen.add(key)
                cpf = re.sub(r"\D", "", row.get("cnpj_cpf") or "")
                name = str(row.get("razao") or row.get("fantasia") or "").strip()
                if not name:
                    continue
                cpf = cpf if len(cpf) == 11 else ""
                document = re.sub(r"\D", "", row.get("cnpj_cpf") or "")
                person = "doc-" + document if len(document) in (11, 14) and len(set(document)) > 1 else "ixc-" + str(key)
                fields = ("telefone_celular", "whatsapp", "fone", "telefone_comercial")
                for rank, field in enumerate(fields):
                    db.executemany("INSERT INTO candidates VALUES (?,?,?,?,?,?)",
                                   [(n, person, key, name, cpf, rank) for n in phones(row.get(field))])
            if len(seen) >= total or not rows:
                break
            page += 1
        if len(seen) != total or not total:
            raise ValueError("Leitura incompleta; índice anterior preservado")
        db.execute("""INSERT INTO contacts(phone,name,cpf)
            WITH exclusive AS (SELECT phone FROM candidates GROUP BY phone HAVING count(DISTINCT person)=1),
            ranked AS (SELECT c.*, row_number() OVER (PARTITION BY person ORDER BY priority, client, phone) AS choice
                       FROM candidates c JOIN exclusive USING (phone))
            SELECT phone,name,cpf FROM ranked WHERE choice=1""")
        db.commit()
        contacts = db.execute("SELECT count(*) FROM contacts").fetchone()[0]
        if not contacts:
            raise ValueError("Nenhum telefone exclusivo; índice anterior preservado")
        print("Ativos consultados:", total, "Contatos com telefone exclusivo:", contacts)
    finally:
        db.close()


if __name__ == "__main__":
    with open(str(INDEX)+".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fd, temp = tempfile.mkstemp(dir=INDEX.parent, prefix=".ixc-", suffix=".sqlite")
        os.close(fd)
        try:
            sync(temp, json.loads(CREDS.read_text()))
            os.chown(temp, 1001, 1001)
            os.chmod(temp, 0o400)
            os.replace(temp, INDEX)
        finally:
            Path(temp).unlink(missing_ok=True)
