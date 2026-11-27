import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from io import BytesIO

source = Path(__file__).resolve().parents[1] / "scripts" / "sync-ixc-contacts.py"
# The production sync uses the Linux file lock in its CLI only.
with patch.dict("sys.modules", {"fcntl": object()}):
    spec = importlib.util.spec_from_file_location("ixc_sync", source)
    sync = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sync)


class DirectoryTest(unittest.TestCase):
    def test_unique_contact_with_exclusive_fallback(self):
        def row(key, cpf, mobile, other=""):
            return dict(id=key, razao=str(key), ativo="S", cnpj_cpf=cpf,
                        telefone_celular=mobile, whatsapp=other)
        rows = [
            row(1, "012.345.678-90", "+55 (34) 99999-0001", "34999990002"),
            row(2, "01234567890", "34999990002"),
            row(3, "09876543210", "034999990001", "34999990003"),
            row(4, "", "34999990001"),
            row(5, "", "34999990005", "34999990006")
        ]
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "index.sqlite"
            data = BytesIO(json.dumps(dict(registros=rows, total=5)).encode())
            with patch.object(sync, "urlopen", return_value=data):
                sync.sync(file, dict(ixc_api_token="test", ixc_api_url="https://ixc.test"))
            with sqlite3.connect(file) as db:
                result = db.execute("SELECT phone,cpf FROM contacts ORDER BY phone").fetchall()
            self.assertEqual(result, [("34999990002","01234567890"), ("34999990003","09876543210"), ("34999990005","")])
            db.close()


if __name__ == "__main__":
    unittest.main()
