"""Fetch the real product icons for the service catalog, clean them, and write the icon manifest.

Run from the repository root:  python -I tools/fetch_icons.py

Every source is pinned (a dated AWS package, git commits, an npm version), so a rerun gives the same files.
Downloads are untrusted: every SVG is parsed after a DOCTYPE/ENTITY check and rebuilt from an allowlist of
elements and attributes (no scripts, no event handlers, no external references, no foreignObject).

Writes
  design/icons/aws/<role>.svg, design/icons/aws/group-<kind>.svg   official AWS Architecture Icons (git-ignored, see SOURCES.md)
  design/icons/oss/<product>.svg                                    open-source project logos
  design/icons/manifest.json                                        catalog: role -> AWS product, open-source products, files, licences, sources
  design/icons/catalog.js                                           the same, as window.ICON_CATALOG for pages opened from disk
AWS icons are written unchanged in shape and colour; the editor shows them upright and uncropped.
"""
import io
import json
import re
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "design" / "icons"
CACHE = Path(tempfile.gettempdir()) / "sde-icons-cache"

AWS_ZIP = ("https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/"
           "Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip")
AWS_RELEASE = "2026-07-31"
GIL_SHA = "b9edc65f8946027cb5e2fe6c772e914cf3649fba"          # gilbarbara/logos, CC0-1.0
SI_VERSION = "16.38.0"                                         # simple-icons, CC0-1.0
CNCF_SHA = "099d60e33670b00b3f6a82843c9acd69d791b698"         # cncf/artwork, Linux Foundation trademark policy

STICKER = "#FFFDF8"   # the light sticker every logo sits on (tokens.css --sticker)
INK = "#1E1B17"

def gil(name):
    return {"kind": "gilbarbara", "url": f"https://raw.githubusercontent.com/gilbarbara/logos/{GIL_SHA}/logos/{name}",
            "source": f"gilbarbara/logos@{GIL_SHA[:7]} logos/{name}", "file_licence": "CC0-1.0"}

def si(slug, title):
    return {"kind": "simple-icons", "slug": slug, "title": title,
            "url": f"https://cdn.jsdelivr.net/npm/simple-icons@{SI_VERSION}/icons/{slug}.svg",
            "source": f"simple-icons@{SI_VERSION} icons/{slug}.svg", "file_licence": "CC0-1.0"}

def cncf(path):
    return {"kind": "cncf", "url": f"https://raw.githubusercontent.com/cncf/artwork/{CNCF_SHA}/{path}",
            "source": f"cncf/artwork@{CNCF_SHA[:7]} {path}", "file_licence": "Linux Foundation trademark policy"}

# role -> (AWS product, AWS short name, file name in the AWS package, [open-source products])
# Open-source product: (id, name, short name, project licence as read from its repository on 2026-11-20, logo source or None)
CATALOG = {
    "client":         (None, None, None, []),
    "mobile":         (None, None, None, []),
    "dns":            ("Amazon Route 53", "Route 53", "Arch_Amazon-Route-53_48.svg",
                       [("coredns", "CoreDNS", "CoreDNS", "Apache-2.0", cncf("projects/coredns/icon/color/coredns-icon-color.svg"))]),
    "cdn":            ("Amazon CloudFront", "CloudFront", "Arch_Amazon-CloudFront_48.svg",
                       [("varnish", "Varnish Cache", "Varnish", "BSD-2-Clause", None)]),
    "load-balancer":  ("Elastic Load Balancing", "ELB", "Arch_Elastic-Load-Balancing_48.svg",
                       [("haproxy", "HAProxy", "HAProxy", "GPL-2.0 (LGPL headers)", si("haproxy", "HAProxy")),
                        ("nginx", "NGINX", "NGINX", "BSD-2-Clause", gil("nginx.svg"))]),
    "api-gateway":    ("Amazon API Gateway", "API Gateway", "Arch_Amazon-API-Gateway_48.svg",
                       [("kong", "Kong Gateway", "Kong", "Apache-2.0", gil("kong-icon.svg"))]),
    "waf":            ("AWS WAF", "WAF", "Arch_AWS-WAF_48.svg",
                       [("modsecurity", "ModSecurity", "ModSecurity", "Apache-2.0", None)]),
    "nat":            ("NAT gateway", "NAT gateway", "Res_Amazon-VPC_NAT-Gateway_48.svg",
                       [("linux-nat", "Linux NAT (nftables)", "Linux NAT", "GPL-2.0", gil("linux-tux.svg"))]),
    "vm":             ("Amazon EC2", "EC2", "Arch_Amazon-EC2_48.svg",
                       [("qemu-kvm", "QEMU/KVM", "QEMU/KVM", "GPL-2.0", si("qemu", "QEMU")),
                        ("openstack-nova", "OpenStack Nova", "Nova", "Apache-2.0", gil("openstack-icon.svg"))]),
    "autoscaling":    ("Amazon EC2 Auto Scaling", "Auto Scaling", "Arch_Amazon-EC2-Auto-Scaling_48.svg",
                       [("k8s-hpa", "Kubernetes HPA", "K8s HPA", "Apache-2.0", gil("kubernetes.svg"))]),
    "containers":     ("Amazon ECS", "ECS", "Arch_Amazon-Elastic-Container-Service_48.svg",
                       [("docker", "Docker Engine (Moby)", "Docker", "Apache-2.0", gil("docker-icon.svg"))]),
    "kubernetes":     ("Amazon EKS", "EKS", "Arch_Amazon-Elastic-Kubernetes-Service_48.svg",
                       [("kubernetes", "Kubernetes", "Kubernetes", "Apache-2.0", gil("kubernetes.svg"))]),
    "function":       ("AWS Lambda", "Lambda", "Arch_AWS-Lambda_48.svg",
                       [("knative", "Knative Functions", "Knative", "Apache-2.0", si("knative", "Knative"))]),
    "object-storage": ("Amazon S3", "S3", "Arch_Amazon-Simple-Storage-Service_48.svg",
                       [("minio", "MinIO", "MinIO", "AGPL-3.0", si("minio", "MinIO")),
                        ("ceph-rgw", "Ceph Object Gateway", "Ceph RGW", "LGPL-2.1/3.0", si("ceph", "Ceph"))]),
    "block-storage":  ("Amazon EBS", "EBS", "Arch_Amazon-Elastic-Block-Store_48.svg",
                       [("ceph-rbd", "Ceph RBD", "Ceph RBD", "LGPL-2.1/3.0", si("ceph", "Ceph"))]),
    "file-storage":   ("Amazon EFS", "EFS", "Arch_Amazon-EFS_48.svg",
                       [("linux-nfs", "Linux NFS server", "NFS", "GPL-2.0", gil("linux-tux.svg"))]),
    "relational-db":  ("Amazon RDS", "RDS", "Arch_Amazon-RDS_48.svg",
                       [("postgresql", "PostgreSQL", "PostgreSQL", "PostgreSQL", gil("postgresql.svg")),
                        ("mysql", "MySQL Community", "MySQL", "GPL-2.0", gil("mysql-icon.svg")),
                        ("mariadb", "MariaDB", "MariaDB", "GPL-2.0", gil("mariadb-icon.svg"))]),
    "nosql-db":       ("Amazon DynamoDB", "DynamoDB", "Arch_Amazon-DynamoDB_48.svg",
                       [("cassandra", "Apache Cassandra", "Cassandra", "Apache-2.0", gil("cassandra.svg"))]),
    "cache":          ("Amazon ElastiCache", "ElastiCache", "Arch_Amazon-ElastiCache_48.svg",
                       [("valkey", "Valkey", "Valkey", "BSD-3-Clause", gil("valkey-icon.svg")),
                        ("memcached", "Memcached", "Memcached", "BSD-3-Clause", gil("memcached.svg")),
                        ("redis", "Redis (under its AGPLv3 option)", "Redis", "AGPL-3.0 option (also RSALv2, SSPLv1)", gil("redis.svg"))]),
    "queue":          ("Amazon SQS", "SQS", "Arch_Amazon-Simple-Queue-Service_48.svg",
                       [("rabbitmq", "RabbitMQ", "RabbitMQ", "MPL-2.0", gil("rabbitmq-icon.svg"))]),
    "pubsub":         ("Amazon SNS", "SNS", "Arch_Amazon-Simple-Notification-Service_48.svg",
                       [("nats", "NATS", "NATS", "Apache-2.0", gil("nats-icon.svg"))]),
    "stream":         ("Amazon Kinesis Data Streams", "Kinesis", "Arch_Amazon-Kinesis-Data-Streams_48.svg",
                       [("kafka", "Apache Kafka", "Kafka", "Apache-2.0", gil("kafka-icon.svg"))]),
    "monitoring":     ("Amazon CloudWatch", "CloudWatch", "Arch_Amazon-CloudWatch_48.svg",
                       [("prometheus", "Prometheus", "Prometheus", "Apache-2.0", gil("prometheus.svg")),
                        ("grafana", "Grafana", "Grafana", "AGPL-3.0", gil("grafana.svg"))]),
    "logs":           ("Amazon CloudWatch Logs", "CW Logs", "Res_Amazon-CloudWatch_Logs_48.svg",
                       [("opensearch", "OpenSearch", "OpenSearch", "Apache-2.0", gil("opensearch-icon.svg")),
                        ("loki", "Grafana Loki", "Loki", "AGPL-3.0", None)]),
    "identity":       ("AWS IAM", "IAM", "Arch_AWS-Identity-and-Access-Management_48.svg",
                       [("keycloak", "Keycloak", "Keycloak", "Apache-2.0", si("keycloak", "Keycloak"))]),
    "secrets":        ("AWS Secrets Manager", "Secrets Mgr", "Arch_AWS-Secrets-Manager_48.svg",
                       [("openbao", "OpenBao", "OpenBao", "MPL-2.0", si("openbao", "OpenBao"))]),
    "registry":       ("Amazon ECR", "ECR", "Arch_Amazon-Elastic-Container-Registry_48.svg",
                       [("harbor", "Harbor", "Harbor", "Apache-2.0", si("harbor", "Harbor"))]),
}
CATALOG.update({
    "service":   (None, None, None, []),
    "web-app":   (None, None, None, []),
    "external":  (None, None, None, []),
    "device":    (None, None, None, []),
    "job":       ("AWS Batch", "Batch", "Arch_AWS-Batch_48.svg", []),
    "search":    ("Amazon OpenSearch Service", "OpenSearch", "Arch_Amazon-OpenSearch-Service_48.svg",
                  [("opensearch-search", "OpenSearch", "OpenSearch", "Apache-2.0", gil("opensearch-icon.svg"))]),
    "warehouse": ("Amazon Redshift", "Redshift", "Arch_Amazon-Redshift_48.svg",
                  [("clickhouse", "ClickHouse", "ClickHouse", "Apache-2.0", si("clickhouse", "ClickHouse"))]),
})

# The neutral catalog every diagram is written in: role -> (generic name, category, block shape). Packs only rename and re-icon.
ROLE_INFO = {
    "client": ("Users", "client", "plate"), "mobile": ("Mobile app", "client", "plate"), "device": ("Device", "client", "plate"),
    "external": ("External system", "client", "plate"), "web-app": ("Web front end", "compute", "box"),
    "service": ("Service", "compute", "box"), "job": ("Batch job", "compute", "box"),
    "dns": ("DNS", "network", "box"), "cdn": ("CDN", "network", "box"), "load-balancer": ("Load balancer", "network", "box"),
    "api-gateway": ("API gateway", "network", "box"), "waf": ("Web firewall", "security", "box"), "nat": ("NAT", "network", "box"),
    "vm": ("Virtual machine", "compute", "box"), "autoscaling": ("Autoscaling group", "compute", "box"),
    "containers": ("Containers", "compute", "box"), "kubernetes": ("Kubernetes cluster", "compute", "box"),
    "function": ("Function", "compute", "box"), "object-storage": ("Object storage", "storage", "low"),
    "block-storage": ("Block storage", "storage", "low"), "file-storage": ("File storage", "storage", "low"),
    "relational-db": ("Relational database", "database", "cyl"), "nosql-db": ("NoSQL database", "database", "cyl"),
    "cache": ("Cache", "database", "cyl"), "search": ("Search index", "database", "cyl"), "warehouse": ("Data warehouse", "database", "cyl"),
    "queue": ("Queue", "messaging", "box"), "pubsub": ("Pub/sub topic", "messaging", "box"), "stream": ("Event stream", "messaging", "box"),
    "monitoring": ("Monitoring", "observe", "box"), "logs": ("Logs", "observe", "box"),
    "identity": ("Identity", "security", "box"), "secrets": ("Secrets", "security", "box"), "registry": ("Image registry", "compute", "low"),
}
# Neutral zone kinds and what each pack calls them.
ZONE_KINDS = {"region": "Region", "network": "Network", "zone": "Failure zone", "subnet": "Subnet", "group": "Group"}
AWS_ZONE_NAMES = {"region": "Region", "network": "VPC", "zone": "Availability Zone", "subnet": "Subnet", "group": "Group"}
AWS_GROUPS = {"region": "Region_32.svg", "network": "Virtual-private-cloud-VPC_32.svg", "subnet-public": "Public-subnet_32.svg",
              "subnet-private": "Private-subnet_32.svg", "cloud": "AWS-Cloud_32.svg"}

# Left out of the open-source column after reading their licences (2026-11-20): not OSI-approved.
EXCLUDED = {"HashiCorp Nomad": "Business Source License 1.1", "HashiCorp Vault": "Business Source License 1.1",
            "ScyllaDB": "ScyllaDB Software License Agreement 1.1 (source-available, April 2026)",
            "MongoDB": "Server Side Public License v1", "OpenFaaS CE": "Community Edition EULA (commercial use needs a licence)"}

# ---------------------------------------------------------------- download

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "system-design-editor-icon-fetch"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def cached(url, name):
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / name
    if not p.exists():
        p.write_bytes(get(url))
    return p.read_bytes()

# ---------------------------------------------------------------- clean

SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XLINK)
TAGS = {"svg", "g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "defs", "linearGradient",
        "radialGradient", "stop", "clipPath", "mask", "title"}
ATTRS = {"viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "d", "points",
         "transform", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
         "stroke-miterlimit", "stroke-dasharray", "stroke-opacity", "opacity", "clip-path", "clip-rule", "mask",
         "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity", "preserveAspectRatio",
         "maskUnits", "clipPathUnits", "style", "id", "href"}
STYLE_PROPS = {"fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
               "stroke-miterlimit", "stroke-opacity", "opacity", "stop-color", "stop-opacity", "clip-rule"}
REF_TAGS = {"linearGradient", "radialGradient", "clipPath", "mask"}
URL = re.compile(r"url\(([^)]*)\)")

def safe_value(v):
    for ref in URL.findall(v):
        if not ref.strip(" '\"").startswith("#"):
            return False
    return "javascript:" not in v.lower() and "expression(" not in v.lower()

def clean(data, prefix, fill=None):
    head = data[:4096].lower()
    if b"<!doctype" in head or b"<!entity" in head or b"<!entity" in data.lower():
        raise ValueError("DOCTYPE or ENTITY in SVG: refused")
    root = ET.fromstring(data)

    def local(tag):
        return tag.split("}", 1)[-1]

    def walk(el):
        for child in list(el):
            if not isinstance(child.tag, str) or local(child.tag) not in TAGS:
                el.remove(child)
                continue
            walk(child)
        keep = {}
        for k, v in el.attrib.items():
            name = local(k)
            if name not in ATTRS or name.startswith("on"):
                continue
            if name == "href":
                if v.startswith("#"):
                    keep[f"{{{XLINK}}}href" if k.startswith(f"{{{XLINK}}}") else "href"] = f"#{prefix}-{v[1:]}"
                continue
            if name == "id":
                if local(el.tag) in REF_TAGS:
                    keep["id"] = f"{prefix}-{v}"
                continue
            if name == "style":
                decls = []
                for part in v.split(";"):
                    if ":" in part:
                        p, val = (s.strip() for s in part.split(":", 1))
                        if p in STYLE_PROPS and safe_value(val):
                            decls.append(f"{p}:{URL.sub(lambda m: f'url(#{prefix}-' + m.group(1).strip(chr(39) + chr(34)).lstrip('#') + ')', val)}")
                if decls:
                    keep["style"] = ";".join(decls)
                continue
            if not safe_value(v):
                continue
            keep[k] = URL.sub(lambda m: f"url(#{prefix}-" + m.group(1).strip("'\"").lstrip("#") + ")", v)
        el.attrib.clear()
        el.attrib.update(keep)

    if local(root.tag) != "svg":
        raise ValueError("not an SVG")
    walk(root)
    if fill:
        root.set("fill", fill)
    if "viewBox" not in root.attrib and "width" in root.attrib and "height" in root.attrib:
        w, h = (re.sub(r"[^0-9.]", "", root.get(a)) for a in ("width", "height"))
        root.set("viewBox", f"0 0 {w} {h}")
    return ET.tostring(root, encoding="unicode")

# ---------------------------------------------------------------- colour for one-colour glyphs

def lum(hexstr):
    def ch(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hexstr[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)

def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

# ---------------------------------------------------------------- main

def main():
    (OUT / "aws").mkdir(parents=True, exist_ok=True)
    (OUT / "oss").mkdir(parents=True, exist_ok=True)
    zf = zipfile.ZipFile(io.BytesIO(cached(AWS_ZIP, "aws-icons-2026-07-31.zip")))
    members = [n for n in zf.namelist() if not n.startswith("__MACOSX") and n.endswith(".svg")]

    def aws_member(fname):
        hits = [n for n in members if n.endswith("/" + fname)]
        if len(hits) != 1:
            raise SystemExit(f"AWS package: expected one {fname}, found {len(hits)}")
        return hits[0]

    si_data = json.loads(cached(f"https://cdn.jsdelivr.net/npm/simple-icons@{SI_VERSION}/data/simple-icons.json", f"simple-icons-{SI_VERSION}.json"))
    si_entries = si_data if isinstance(si_data, list) else si_data.get("icons", [])
    def si_slug(e):
        return e.get("slug") or re.sub(r"[^a-z0-9]", "", e["title"].lower())
    si_hex = {si_slug(e): "#" + e["hex"] for e in si_entries}

    # The core catalog is neutral (roles, zone kinds). Each pack renames and re-icons it; the editor never needs a pack.
    manifest = {"generated_by": "tools/fetch_icons.py", "sticker": STICKER,
                "trademarks": "Logos and product names are trademarks of their owners and are used only to name the products.",
                "roles": {r: {"name": n, "category": c, "shape": s} for r, (n, c, s) in ROLE_INFO.items()},
                "zone_kinds": ZONE_KINDS,
                "packs": {
                    "generic": {"name": "Generic", "about": "Role names and line icons. No vendor.", "products": {}},
                    "aws": {"name": "AWS", "about": "Official AWS Architecture Icons, shown unmodified.",
                            "source": {"package": AWS_ZIP, "release": AWS_RELEASE,
                                       "terms": "AWS allows customers and partners to use the icons to create architecture diagrams (aws.amazon.com/architecture/icons)."},
                            "zone_names": AWS_ZONE_NAMES, "groups": {}, "products": {}},
                    "oss": {"name": "Open source", "about": "Projects under OSI-approved licences, with their logos.",
                            "source": {"gilbarbara/logos": {"commit": GIL_SHA, "licence": "CC0-1.0"},
                                       "simple-icons": {"version": SI_VERSION, "licence": "CC0-1.0"},
                                       "cncf/artwork": {"commit": CNCF_SHA, "licence": "Linux Foundation trademark policy"}},
                            "excluded": EXCLUDED, "products": {}},
                }}
    aws_pack, oss_pack = manifest["packs"]["aws"], manifest["packs"]["oss"]

    for kind, fname in AWS_GROUPS.items():
        (OUT / "aws" / f"group-{kind}.svg").write_text(clean(zf.read(aws_member(fname)), f"awsg-{kind}"), encoding="utf-8")
        aws_pack["groups"][kind] = {"icon": f"aws/group-{kind}.svg", "source": aws_member(fname)}

    written, failed = {}, []
    for role, (aws, aws_short, aws_file, oss) in CATALOG.items():
        if aws:
            m = aws_member(aws_file)
            (OUT / "aws" / f"{role}.svg").write_text(clean(zf.read(m), f"aws-{role}"), encoding="utf-8")
            aws_pack["products"][role] = {"name": aws, "short": aws_short, "icon": f"aws/{role}.svg", "source": m}
        items = []
        for pid, name, short, licence, src in oss:
            item = {"id": pid, "name": name, "short": short, "licence": licence, "icon": None, "source": None}
            if src:
                if src["url"] not in written:
                    try:
                        data = get(src["url"])
                    except Exception as e:  # a missing logo falls back to the line icon
                        failed.append(f"{name} ({e})")
                        written[src["url"]] = None
                    else:
                        fill = None
                        if src["kind"] == "simple-icons":
                            brand = si_hex.get(src["slug"])
                            fill = brand if brand and contrast(brand, STICKER) >= 3 else INK
                        out_name = src["url"].rsplit("/", 1)[-1].replace("-icon-color", "").replace("-icon", "")
                        out_name = re.sub(r"[^a-z0-9.-]", "", out_name.lower())
                        (OUT / "oss" / out_name).write_text(clean(data, "oss-" + out_name[:-4], fill), encoding="utf-8")
                        written[src["url"]] = f"oss/{out_name}"
                if written[src["url"]]:
                    item.update(icon=written[src["url"]], source=src["source"], file_licence=src["file_licence"])
            items.append(item)
        if items:
            oss_pack["products"][role] = items

    text = json.dumps(manifest, indent=2, ensure_ascii=False)
    (OUT / "manifest.json").write_text(text + "\n", encoding="utf-8")
    (OUT / "catalog.js").write_text("// Generated by tools/fetch_icons.py from manifest.json. Do not edit.\nwindow.ICON_CATALOG = " + text + ";\n", encoding="utf-8")
    n_aws = len(aws_pack["products"]) + len(aws_pack["groups"])
    n_oss = len({v for v in written.values() if v})
    missing = [i["name"] for items in oss_pack["products"].values() for i in items if not i["icon"]]
    print(f"AWS icons: {n_aws}  open-source logos: {n_oss}  without a logo: {', '.join(missing) or 'none'}")
    if failed:
        print("Downloads that failed:", "; ".join(failed))

if __name__ == "__main__":
    sys.exit(main())
