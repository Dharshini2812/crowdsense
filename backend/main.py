
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageFilter, ImageEnhance
import io
import cv2
import numpy as np
from ultralytics import YOLO
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load YOLO model — downloads once, runs offline forever
model = YOLO("yolov8n.pt")

prev_count = {"value": 0}
frame_history = []

def preprocess_image(image):
    w, h = image.size
    if w < 400:
        scale = 400 / w
        image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    image = image.filter(ImageFilter.SHARPEN)
    image = ImageEnhance.Contrast(image).enhance(1.3)
    image = ImageEnhance.Brightness(image).enhance(1.1)
    return image

def calculate_risk(person_count, prev_count_val, history):
    density_score = min(person_count / 25, 1.0)
    surge = max(person_count - prev_count_val, 0)
    surge_score = min(surge / 8, 1.0)

    if len(history) >= 3:
        avg = sum(history[-3:]) / 3
        trend_score = min(max(person_count - avg, 0) / 5, 1.0)
    else:
        trend_score = 0

    risk = (density_score * 0.6) + (surge_score * 0.25) + (trend_score * 0.15)
    return round(min(risk, 1.0), 2)

def get_risk_level(score):
    if score < 0.35:
        return "safe"
    elif score < 0.65:
        return "warning"
    else:
        return "danger"

@app.post("/analyze")
async def analyze_frame(file: UploadFile = File(...)):
    global frame_history

    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    image = preprocess_image(image)

    img_array = np.array(image)

    # Run YOLO — detect only people (class 0)
    results = model(img_array, classes=[0], conf=0.25, verbose=False)

    detections = []
    for result in results:
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cx = (x1 + x2) / 2
            cy = (y1 + y2) / 2
            w = x2 - x1
            h = y2 - y1
            conf = float(box.conf[0])
            detections.append({
                "x": cx,
                "y": cy,
                "width": w,
                "height": h,
                "confidence": round(conf, 2)
            })

    person_count = len(detections)
    frame_history.append(person_count)
    if len(frame_history) > 10:
        frame_history = frame_history[-10:]

    risk_score = calculate_risk(person_count, prev_count["value"], frame_history)
    risk_level = get_risk_level(risk_score)
    prev_count["value"] = person_count

    print(f"YOLO | People: {person_count} | Risk: {risk_score} | Level: {risk_level}")

    return {
        "person_count": person_count,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "detections": detections,
        "detection_method": "yolo"
    }

@app.get("/")
def root():
    return {"status": "CrowdSense backend running"}