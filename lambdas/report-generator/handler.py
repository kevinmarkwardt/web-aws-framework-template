"""YourApp Report Generator — monthly PDF reports for Pro users.

Triggered by EventBridge on the 1st of each month at 6 AM ET.
Generates a portfolio health PDF report, archives to S3, sends via SES.
"""

from __future__ import annotations

import io
import json
import os
from collections import Counter
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

import boto3
from boto3.dynamodb.conditions import Key
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)

TABLE_NAME = os.environ.get("TABLE_NAME", "yourapp")
REPORT_BUCKET = os.environ.get("REPORTS_BUCKET", "yourapp-reports")
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "reports@yourapp.com")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://yourapp.com")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
s3 = boto3.client("s3")
ses = boto3.client("ses")
bedrock = boto3.client("bedrock-runtime")


def lambda_handler(event, context):
    """Generate monthly portfolio health PDF report."""
    now = datetime.now(timezone.utc)
    month_ago = (now - timedelta(days=30)).isoformat()
    report_month = now.strftime("%B %Y")

    users = _scan_pro_users()
    reports_generated = 0

    for user in users:
        email = user.get("email", "")
        if not email:
            continue

        user_id = user.get("userId", "")
        links = _get_user_links(user_id)
        pitches = _get_user_pitches(user_id)

        if not links:
            continue

        pdf_bytes = _generate_pdf(user_id, links, pitches, report_month, month_ago)

        # Archive to S3
        s3_key = f"reports/{user_id}/{now.strftime('%Y-%m')}.pdf"
        s3.put_object(
            Bucket=REPORT_BUCKET,
            Key=s3_key,
            Body=pdf_bytes,
            ContentType="application/pdf",
        )

        # Send via SES with attachment
        _send_report_email(email, pdf_bytes, report_month)
        reports_generated += 1

    return {"reportsGenerated": reports_generated}


def _scan_pro_users() -> list[dict]:
    items = []
    params = {
        "FilterExpression": Key("sk").eq("PROFILE"),
    }
    while True:
        resp = table.scan(**params)
        for item in resp.get("Items", []):
            if item.get("plan") == "pro":
                items.append(item)
        if "LastEvaluatedKey" not in resp:
            break
        params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items


def _get_user_links(user_id: str) -> list[dict]:
    resp = table.query(
        KeyConditionExpression=(
            Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("LINK#")
        )
    )
    return resp.get("Items", [])


def _get_user_pitches(user_id: str) -> list[dict]:
    resp = table.query(
        KeyConditionExpression=(
            Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("PITCH#")
        )
    )
    return resp.get("Items", [])


def _generate_pdf(
    user_id: str,
    links: list[dict],
    pitches: list[dict],
    report_month: str,
    month_ago: str,
) -> bytes:
    """Generate portfolio health PDF report."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.75 * inch)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title2", parent=styles["Title"], fontSize=18)
    heading_style = ParagraphStyle("Heading", parent=styles["Heading2"], fontSize=14)
    story = []

    # Title
    story.append(Paragraph(f"YourApp Portfolio Health Report", title_style))
    story.append(Paragraph(f"{report_month}", styles["Normal"]))
    story.append(Spacer(1, 0.3 * inch))

    # Summary stats
    total = len(links)
    live = sum(1 for l in links if l.get("status") == "LIVE")
    missing = sum(1 for l in links if l.get("status") == "MISSING")
    errors = sum(1 for l in links if l.get("status") in ("404", "ERROR", "REDIRECT"))

    # Count losses/gains this month
    lost_this_month = 0
    regained_this_month = 0
    for link in links:
        for entry in link.get("statusHistory", []):
            if entry.get("date", "") >= month_ago:
                if entry.get("status") in ("MISSING", "404"):
                    lost_this_month += 1
                elif entry.get("status") == "LIVE":
                    regained_this_month += 1

    story.append(Paragraph("Overview", heading_style))
    summary_data = [
        ["Metric", "Value"],
        ["Total Active Links", str(total)],
        ["Live", str(live)],
        ["Missing", str(missing)],
        ["Errors (404/Redirect/Other)", str(errors)],
        ["Links Lost This Month", str(lost_this_month)],
        ["Links Regained This Month", str(regained_this_month)],
    ]
    summary_table = Table(summary_data, colWidths=[3 * inch, 2 * inch])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a56db")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 0.3 * inch))

    # Publisher breakdown (links per domain)
    story.append(Paragraph("Publisher Breakdown", heading_style))
    domain_counts = Counter()
    for link in links:
        domain = urlparse(link.get("pageUrl", "")).netloc
        domain_counts[domain] += 1

    pub_data = [["Domain", "Links"]]
    for domain, count in domain_counts.most_common(15):
        pub_data.append([domain, str(count)])

    if len(pub_data) > 1:
        pub_table = Table(pub_data, colWidths=[4 * inch, 1 * inch])
        pub_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a56db")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
        ]))
        story.append(pub_table)
    story.append(Spacer(1, 0.3 * inch))

    # Average link age
    now = datetime.now(timezone.utc)
    ages = []
    for link in links:
        added = link.get("firstAdded", "")
        if added:
            try:
                added_dt = datetime.fromisoformat(added.replace("Z", "+00:00"))
                ages.append((now - added_dt).days)
            except (ValueError, TypeError):
                pass
    avg_age = sum(ages) / len(ages) if ages else 0

    story.append(Paragraph(f"Average Link Age: {avg_age:.0f} days", styles["Normal"]))
    story.append(Spacer(1, 0.2 * inch))

    # Anchor text diversity
    story.append(Paragraph("Anchor Text Distribution", heading_style))
    anchor_analysis = _analyze_anchors(links)
    anchor_data = [["Type", "Count", "Percentage"]]
    total_anchors = sum(anchor_analysis.values()) or 1
    for atype, count in sorted(anchor_analysis.items(), key=lambda x: -x[1]):
        pct = (count / total_anchors) * 100
        anchor_data.append([atype, str(count), f"{pct:.1f}%"])

    anchor_table = Table(anchor_data, colWidths=[2.5 * inch, 1 * inch, 1.5 * inch])
    anchor_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a56db")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
    ]))
    story.append(anchor_table)
    story.append(Spacer(1, 0.2 * inch))

    # AI anchor text recommendation
    recommendation = _get_anchor_recommendation(anchor_analysis)
    if recommendation:
        story.append(Paragraph(f"Recommendation: {recommendation}", styles["Normal"]))
        story.append(Spacer(1, 0.2 * inch))

    # Pipeline conversion rate
    if pitches:
        story.append(Paragraph("Pipeline Performance", heading_style))
        total_pitches = len(pitches)
        published = sum(1 for p in pitches if p.get("status") == "PUBLISHED")
        conversion = (published / total_pitches * 100) if total_pitches else 0
        story.append(Paragraph(
            f"Total pitches: {total_pitches} | Published: {published} | "
            f"Conversion rate: {conversion:.1f}%",
            styles["Normal"],
        ))
        story.append(Spacer(1, 0.2 * inch))

    # Footer
    story.append(Spacer(1, 0.5 * inch))
    story.append(Paragraph(
        f"Generated by YourApp on {now.strftime('%B %d, %Y')}",
        ParagraphStyle("Footer", parent=styles["Normal"], fontSize=8, textColor=colors.grey),
    ))

    doc.build(story)
    return buffer.getvalue()


def _analyze_anchors(links: list[dict]) -> dict:
    """Classify anchor texts into categories."""
    categories = Counter()
    for link in links:
        text = link.get("anchorText", "").strip().lower()
        if not text:
            categories["No anchor text"] += 1
        elif _is_url(text):
            categories["Naked URL"] += 1
        elif text in ("click here", "here", "this", "read more", "learn more", "link"):
            categories["Generic"] += 1
        elif _is_branded(text, link.get("destinationUrl", "")):
            categories["Branded"] += 1
        else:
            categories["Keyword-rich"] += 1
    return dict(categories)


def _is_url(text: str) -> bool:
    return text.startswith("http://") or text.startswith("https://") or text.startswith("www.")


def _is_branded(text: str, destination_url: str) -> bool:
    domain = urlparse(destination_url).netloc.lower().replace("www.", "")
    brand = domain.split(".")[0] if domain else ""
    return brand in text if brand else False


def _get_anchor_recommendation(analysis: dict) -> str:
    """Use Bedrock Haiku for anchor text strategy recommendation."""
    try:
        prompt = (
            f"Given this anchor text distribution for a backlink portfolio: {json.dumps(analysis)}. "
            f"Provide a 2-sentence recommendation on anchor text strategy for SEO. "
            f"Be specific and actionable."
        )
        response = bedrock.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 150,
                "messages": [{"role": "user", "content": prompt}],
            }),
        )
        result = json.loads(response["body"].read())
        content = result.get("content", [])
        if content:
            return content[0].get("text", "")
    except Exception:
        pass
    return ""


def _send_report_email(email: str, pdf_bytes: bytes, report_month: str):
    """Send report email with PDF attachment via SES raw email."""
    import base64
    from email.mime.application import MIMEApplication
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    msg = MIMEMultipart()
    msg["Subject"] = f"YourApp Monthly Report — {report_month}"
    msg["From"] = SES_FROM_EMAIL
    msg["To"] = email

    body_text = (
        f"Your YourApp Portfolio Health Report for {report_month} is attached.\n\n"
        f"View your dashboard: {FRONTEND_URL}/dashboard/reports\n"
    )
    msg.attach(MIMEText(body_text, "plain"))

    attachment = MIMEApplication(pdf_bytes, "pdf")
    attachment.add_header(
        "Content-Disposition", "attachment",
        filename=f"yourapp-report-{report_month.lower().replace(' ', '-')}.pdf",
    )
    msg.attach(attachment)

    ses.send_raw_email(
        Source=SES_FROM_EMAIL,
        Destinations=[email],
        RawMessage={"Data": msg.as_string()},
    )
