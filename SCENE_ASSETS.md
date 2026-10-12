# 场景布景素材

八张场景图位于 `public/scenes/`，由内置图像生成工具制作。通用提示词为：

> Use case: illustration-story. Asset type: vertical desktop app scene background behind existing 2D coach. Polished hand-painted anime film background, matte gouache texture, atmospheric depth. Portrait 4:5. Keep the center calm for an existing silver-haired foreground character. No people, characters, words, letters, logos, or UI.

每张图另加以下场景描述：

| 文件 | 场景描述 |
| --- | --- |
| `cafe-ordering.png` | Warm neighborhood café interior; espresso machine and coffee bar on the left, large sunlit window, cups and pastry display; honey wood, cream and sea-blue. |
| `restaurant-dining.png` | Cozy restaurant with a round table set for two, pendant lights, wall sconces, distant banquettes and evening window; amber and blue-gray. |
| `hotel-checkin.png` | Small elegant hotel lobby; reception counter and bell, archway, luggage trolley, lounge seating and receding stone floor; cream, warm wood and muted blue. |
| `airport-travel.png` | Modern departure terminal; check-in counters and baggage conveyor, apron windows with airplane wing, overhead lights and receding tile floor; sky blue, silver and cream. |
| `shopping-returns.png` | Neighborhood clothing shop; garment racks, folded sweaters and shopping bags, fitting room arch and cashier; muted rose, cream and light blue. |
| `directions-transit.png` | City transit setting; blue bus and real shelter with route board, street crossing, receding city blocks, tram stop and soft trees; sea-glass teal, blue-gray and cream. |
| `job-interview.png` | Contemporary interview room; meeting table, two chairs, notebook and water, office windows and city buildings; navy and soft stone. |
| `daily-social.png` | Friendly garden gathering place; café terrace tables, flowers, leafy path, gazebo and warm morning light; sage, cream and blue. |

`public/characters/a-bust-mask-source.png` 由内置图像编辑工具根据 `a-original-matte.png` 生成，编辑提示词要求仅抠出左侧半身人物、移除背景和右侧全身参考图、保留原画细节并输出透明背景。**运行时只读取这张素材的 alpha 通道作为轮廓遮罩**；Mia 的实际脸、五官、发型、衣服和上色仍由未改动的 `a-original-matte.png` 提供。闭眼和张嘴素材也继续使用原有坐标。
