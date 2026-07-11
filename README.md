# Label Bench

YOLO 계열 모델을 중심으로 이미지를 자동 추론하고, 브라우저에서 바운딩 박스를 수정한 뒤 YOLO, COCO, Pascal VOC 형식으로 내보내는 로컬 반자동 라벨링 도구입니다. Ultralytics가 읽을 수 있는 YOLO v8/v11 가중치와 Hugging Face Transformers의 DETR 계열 객체 검출 모델을 같은 작업 화면에서 사용할 수 있습니다.

## 제공 기능

- 여러 이미지를 한 세션에 불러와 이전/다음 이미지로 이동
- 로컬 `.pt`, `.onnx`, `.engine` 등 Ultralytics 지원 모델 또는 공식 모델 이름 사용
- Hugging Face 모델 ID나 로컬 DETR 모델 디렉터리 사용
- 신뢰도 및 YOLO NMS IoU 설정, CPU/CUDA/자동 장치 선택
- 검출 박스 선택, 이동, 네 모서리 크기 조정, 직접 그리기, 삭제
- 이미지별 Undo/Redo 이력으로 박스 생성·삭제·이동·크기·클래스 변경과 추론 결과 복구
- 모델 예측을 `검수 필요` 제안으로 분리하고 개별·일괄 승인 또는 거부
- 이미지 해시·EXIF/RGB 전처리·입력 크기·threshold·NMS·장치를 기록하는 추론 매니페스트
- 클래스 이름 추가/수정 및 개별 박스 클래스 변경
- `data.yaml` 기반 YOLO 폴더·ZIP과 `classes.txt`·COCO categories 가져오기
- 가져오기 전 클래스 ID 충돌 매핑, split·상대 경로·기존 라벨 보존
- 브라우저 로컬 자동 저장과 마지막 작업 자동 복구
- 원본 이미지와 라벨을 함께 담은 `.vlb.json` 프로젝트 백업 저장/불러오기
- 현재 이미지 또는 전체 세션을 YOLO TXT, COCO JSON, Pascal VOC XML ZIP으로 내보내기
- 원본 이미지는 서버에 저장하지 않고 요청 단위로만 처리

## 빠른 시작

Windows PowerShell에서 다음을 실행합니다.

```powershell
uv sync --extra dev --extra yolo
cd frontend
npm install
npm run build
cd ..
.\run.ps1
```

브라우저에서 `http://127.0.0.1:8010`을 엽니다. `run.ps1`은 빌드된 프런트엔드와 API를 하나의 로컬 서버로 제공합니다.

개발 중에는 터미널 두 개를 사용합니다.

```powershell
# 터미널 1
uv run lb-tool --reload

# 터미널 2
cd frontend
npm run dev
```

개발 화면 주소는 `http://127.0.0.1:5173`입니다.

## 모델 설정

### YOLO v8 / v11

```powershell
uv sync --extra yolo
```

왼쪽 모델 패널에 다음 중 하나를 입력합니다.

- 공식 가중치 이름: `yolov8n.pt`, `yolo11n.pt`
- 학습한 가중치: `D:\models\best.pt`
- Ultralytics가 지원하는 내보낸 모델: `D:\models\best.onnx`

입력창 오른쪽의 폴더 버튼을 누르면 로컬 모델 탐색기가 열립니다. 드라이브와 폴더를 이동한 뒤 모델 파일을 선택하면 절대경로가 자동으로 입력됩니다. 파일을 업로드하거나 복사하지 않고 원래 위치에서 바로 불러오므로 대용량 가중치에도 사용할 수 있습니다.

탐색기에는 폴더와 모델 관련 파일(`.pt`, `.pth`, `.onnx`, `.engine`, `.safetensors`, `.bin`, `.ckpt`, `.tflite`, `.torchscript` 등)만 표시됩니다. 모델 탐색은 파일 경로 노출을 막기 위해 `127.0.0.1` 또는 `localhost`에서 접속할 때만 허용됩니다.

모델을 선택한 뒤 `모델 미리 불러오기`를 누르면 상세 정보 창이 열립니다. 이 창에서 다음을 확인할 수 있습니다.

- 모델 로드 성공 여부와 캐시 재사용 여부
- 어댑터, 장치, 모델 형식, task, 아키텍처, 런타임 버전
- 기본 입력 크기, 파라미터 수, 로컬 모델 파일 크기
- 클래스 개수와 ID별 클래스명 검색
- 모델 로드 시간

이미지를 추가한 상태에서는 상세 정보 창의 `현재 이미지로 테스트`를 눌러 실제 추론까지 확인할 수 있습니다. 성공하면 상태가 `INFERENCE VERIFIED`로 바뀌고 이미지명, 검출 개수, 추론 시간이 표시됩니다.

검증 후 `추론 재현 정보` 영역에서 다음 값을 확인하고 JSON으로 복사하거나 저장할 수 있습니다.

- 원본 파일 SHA-256과 MIME 형식
- 원본/EXIF 보정 후 해상도 및 색상 모드
- 실제 전처리 경로와 모델 입력 크기
- confidence, NMS IoU 적용 여부, 요청/실제 장치
- 클래스별 검출 수와 검출 점수 범위·평균

업로드 이미지는 EXIF 방향을 먼저 적용한 뒤 RGB로 변환합니다. YOLO에는 RGB PIL 이미지를 그대로 전달해 Ultralytics가 letterbox를 수행하도록 하고, DETR에는 Transformers `AutoImageProcessor`를 사용합니다. 다른 환경과 결과가 다르면 저장한 매니페스트의 이미지 해시, 입력 크기, threshold, NMS, 런타임 버전을 먼저 비교하세요.

어댑터를 `자동 판별` 또는 `Ultralytics YOLO`로 둡니다. 자동 판별은 DETR 이름이 포함되지 않은 모델을 YOLO로 처리합니다.

이 프로젝트는 Windows/Linux의 `torch 2.11`, `torchvision 0.26`을 공식 CUDA 12.8 인덱스에서 설치하도록 고정되어 있습니다. CUDA 빌드는 CPU 모드에서도 실행할 수 있습니다. 다른 CUDA 채널이 필요한 환경에서는 `pyproject.toml`의 `pytorch-cu128` URL과 버전을 해당 공식 조합으로 변경한 뒤 다시 동기화하세요.

### DETR 계열

```powershell
uv sync --extra detr
```

모델 ID(예: `facebook/detr-resnet-50`) 또는 로컬 Transformers 모델 디렉터리를 입력하고 어댑터를 `Transformers DETR`로 선택합니다. DETR 표준 후처리는 NMS IoU를 사용하지 않으므로 해당 슬라이더 값은 무시됩니다.

로컬 DETR 모델은 탐색기에서 해당 디렉터리 안으로 이동한 뒤 `이 모델 폴더 사용`을 누르면 됩니다. Hugging Face 모델 ID는 기존처럼 텍스트로 입력합니다.

## 편집 단축키

| 키 | 동작 |
| --- | --- |
| `V` | 선택/이동 도구 |
| `B` | 새 박스 그리기 |
| `Delete` 또는 `Backspace` | 선택 박스 삭제 |
| `[` / `]` | 이전 / 다음 이미지 |
| `Ctrl+Z` 또는 `Cmd+Z` | 현재 이미지의 마지막 편집 실행 취소 |
| `Ctrl+Y`, `Ctrl+Shift+Z` 또는 `Cmd+Shift+Z` | 다시 실행 |
| `Ctrl+S` 또는 `Cmd+S` | 휴대용 프로젝트 백업 저장 |

## 프로젝트 저장과 복구

라벨, 클래스, 모델 설정, 이미지 목록과 내보내기 설정은 변경 후 약 1초 안에 브라우저의 IndexedDB에 자동 저장됩니다. 같은 주소로 앱을 다시 열면 마지막 작업을 자동으로 복구합니다. 왼쪽 `프로젝트` 영역에서 다음 작업을 할 수 있습니다.

- `새 작업`: 현재 로컬 작업을 닫고 빈 프로젝트 시작
- `열기`: `.vlb.json` 프로젝트 백업에서 원본 이미지와 라벨 복구
- `저장`: 현재 원본 이미지와 라벨을 하나의 휴대용 `.vlb.json` 파일로 저장

자동 저장 데이터는 서버가 아니라 현재 브라우저 프로필에만 보관됩니다. 브라우저 데이터 삭제, 시크릿 모드 종료 또는 저장 공간 회수 시 사라질 수 있으므로 중요한 작업은 `저장`으로 별도 백업하세요. 브라우저 저장소는 주소별로 분리되므로 `127.0.0.1:8010`, `localhost:8010`, 개발 서버 `127.0.0.1:5173`의 작업은 서로 공유되지 않습니다. 프로젝트 백업에는 원본 이미지가 포함되어 이미지 수와 크기에 따라 파일이 커질 수 있습니다.

## 데이터셋 가져오기

왼쪽 `프로젝트` 영역의 `데이터셋 가져오기`에서 다음 소스를 선택할 수 있습니다.

- YOLO 폴더: `data.yaml` 또는 `data.yml`, 이미지, `labels/*.txt`를 함께 선택
- YOLO ZIP: 압축을 직접 풀지 않고 브라우저에서 검사
- 클래스 파일: YAML의 `names`, 줄 단위 `classes.txt`, COCO JSON의 `categories`

YOLO의 `train`, `val`, `test` 디렉터리·목록·이미지 목록 TXT를 지원합니다. 적용 전에 이미지·박스·클래스·음성 이미지 수와 오류를 미리 보여주며, 새 작업 또는 현재 작업에 추가할 수 있습니다. 기존 클래스와 ID가 충돌하면 프로젝트 클래스명을 덮어쓰지 않고 매핑을 먼저 확인합니다. segmentation, pose, OBB 라인은 현재 가져오기 대상이 아니며 오류로 표시됩니다.

폴더와 ZIP은 서버에 업로드하지 않고 브라우저 안에서만 해석됩니다. YAML의 절대·원격 경로와 다운로드 스크립트는 실행하지 않습니다.

## 내보내기 규칙

- YOLO: `labels/{train|val|test}/*.txt`, `classes.txt`, `data.yaml`
- COCO: `annotations.json`
- Pascal VOC: `annotations/*.xml`
- 좌표는 내보낼 때 이미지 경계로 제한됩니다.
- 원본 이미지는 기본적으로 제외됩니다. YOLO의 `원본 이미지 포함`을 켜면 `images/{train|val|test}/...`에 포함되어 다시 가져올 수 있습니다.
- YOLO 클래스 ID는 화면과 모델의 원래 숫자를 유지합니다.
- 검수하지 않은 모델 제안은 기본적으로 제외됩니다. 필요하면 내보내기 영역의 `검수 전 모델 제안 포함`을 켤 수 있습니다.

## 모델 제안 검수

모델 추론으로 생성된 박스는 황색 `제안` 상태와 점선 테두리로 표시됩니다. 오른쪽 객체 패널의 `검수 필요` 탭에서 다음 작업을 할 수 있습니다.

- 선택한 제안을 승인하거나 거부
- 현재 이미지의 모든 제안을 한 번에 승인하거나 거부
- 제안 박스의 좌표나 클래스를 수정해 `수정됨` 라벨로 확정
- 승인·거부·수정을 Undo/Redo로 되돌리기

재추론할 때는 기존 수동·승인·수정 라벨을 유지하고 이전의 검수 전 제안만 새 결과로 교체합니다. 같은 클래스의 새 예측이 검수 완료 박스와 거의 동일하게 겹치면 중복 제안을 추가하지 않습니다.

## 품질 확인

```powershell
uv run pytest
uv run ruff check backend tests
cd frontend
npm run build
```

API 상태는 `http://127.0.0.1:8010/api/health`에서 확인할 수 있습니다.

## 프로젝트 구조

```text
backend/lb_tool/
  adapters/       YOLO/DETR 어댑터와 모델 캐시
  app.py          FastAPI 추론·모델·내보내기 API
  exporters.py    YOLO/COCO/VOC ZIP 생성
frontend/src/
  components/     세션, 캔버스, 검사기 UI
  lib/            API와 좌표 유틸리티
tests/             API 및 내보내기 테스트
```
