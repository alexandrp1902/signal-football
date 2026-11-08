# Ракурсы движения и анимация удара

8 ноября 2026 года. Ресурс: [football-cats-directions-v1.png](../../client/public/art/football-cats-directions-v1.png). Создан встроенным инструментом `image_gen` с настоящим прозрачным фоном; исходный `football-cats-v1.png` использован как референс персонажа и стиля.

Атлас 4×2, восемь нейтральных поз. Верхний ряд — синие, нижний — красные. Столбцы: лицо вполоборота, правый профиль, задний ракурс вполоборота, полный вид со спины. Отражение по горизонтали покрывает левые направления. Все кадры разделяются через целочисленные границы `floor`, без отдельных файлов кадров. Исходный атлас сохраняется для подката, восстановления, празднования и стартового экрана.

Ракурс выбирается по скорости движения, с небольшим угловым гистерезисом против дрожания на границах. Остановка сохраняет направление, смена ракурса сохраняет фазу шага. Замах, контакт и завершение удара выполняются деформацией той же текстуры; опорная лапа остаётся на месте. Заряд усиливает замах, а направление ноги фиксируется при отпускании удара. Изменение прицела после отпускания не разворачивает уже выполняемый удар.

## Промпт генерации

```text
Use case: stylized-concept.
Asset type: production transparent 2D football mascot DIRECTION TURNAROUND SPRITE ATLAS for an existing PixiJS game.
Input image 1 is a CHARACTER IDENTITY AND ART STYLE REFERENCE, not an edit target. Match precisely its smooth crisp navy cat, huge rounded head, white muzzle, very large shiny dark eyes, triangular navy ears with white inner ears, short chunky limbs, simple football jersey and shorts, navy shoes. Preserve the exact mascot, proportions, face, colors, and clean dark outlines. No redesign.
Create ONE wide PNG with TRUE ALPHA TRANSPARENCY, exactly 4 columns and 2 rows of equal SQUARE CELLS, 8 complete full-body cats, no visible grid/gutters. Top row: BLUE jersey #0695D7; bottom row: RED jersey #FF4758. Within each row the 4 cells are the SAME neutral standing athletic pose viewed as a turntable:
Column 1: front three-quarter facing screen down-right (southeast), entire face visible, like the reference idle pose.
Column 2: TRUE RIGHT SIDE PROFILE facing screen right (east), one eye visible, muzzle points RIGHT, both feet grounded. Do not show the front view here.
Column 3: REAR THREE-QUARTER facing screen up-right (northeast), mostly back of the navy head and the back of the jersey, just a small edge of cheek, NO big frontal pair of eyes.
Column 4: STRICT FULL REAR VIEW facing screen up (north), BACK OF HEAD toward viewer, back of both ears and back of jersey visible, ABSOLUTELY NO eyes, NO muzzle and NO face visible. This is crucial.
Each cell character registered to IDENTICAL local coordinates: head centered near 52% x, top of ears at 7% height, bottom of head/neck at 58% height, shoulders 61%, hips 77%, soles resting at 94% height, body centered at 52% x. Head width about 60% of cell. Same apparent character height and size in all 8 cells, generous transparent margin. Feet together but separable, two legs straight in a relaxed standing pose, arms hanging at sides, whole silhouette compact and fully within its cell. Keep torso and hips similarly aligned between views so this can be articulated by code. Small tail tucked close to the right hip silhouette. No leg strides, NO running poses, no action poses.
Simple plain jersey backs with NO letters or numbers. Reference white chest dash is only on the front. Camera level and slight football game top-down view consistent across all eight figures. Professional clean cartoon bitmap production art, not pixel art, not 3D, no extra rendering shine. No ball, no field, no floor, no shadows, no text, no labels, no watermark, no framing, no background color, no checkerboard. Exactly EIGHT cats.
```
