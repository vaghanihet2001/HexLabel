// frontend/src/pages/LabelEditor.jsx
import React, { useRef, useState } from 'react'
import { Stage, Layer, Rect, Image as KImage } from 'react-konva'
import useImage from "use-image";

const DemoImage = '/demo.jpg'
function URLImage({src, onLoad}) {
  const [image] = useImage(src)
  return <KImage image={image} onLoad={onLoad}/>
}
export default function LabelEditor(){
  const [rects, setRects] = useState([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [start, setStart] = useState(null)
  const stageRef = useRef()
  const handleMouseDown = (e)=>{
    const stage = stageRef.current
    const pos = stage.getPointerPosition()
    setStart(pos)
    setIsDrawing(true)
  }
  const handleMouseMove = (e)=>{
    if(!isDrawing) return
    const stage = stageRef.current
    const pos = stage.getPointerPosition()
    const x = Math.min(pos.x, start.x)
    const y = Math.min(pos.y, start.y)
    const w = Math.abs(pos.x - start.x)
    const h = Math.abs(pos.y - start.y)
    const newRect = { x, y, width:w, height:h, id: 'r' + rects.length }
    setRects(prev => {
      const copy = prev.slice(0, prev.length-1)
      return [...copy, newRect]
    })
  }
  const handleMouseUp = (e)=>{
    setIsDrawing(false)
    setStart(null)
    // keep rectangles
  }
  const handleMouseDownStart = (e)=>{
    handleMouseDown(e)
    // push a temp rect
    setRects(prev => [...prev, { x:0, y:0, width:0, height:0, id: 'r' + prev.length }])
  }
  return (
    <div>
      <h2 style={{fontSize:20, fontWeight:600}}>Label Editor</h2>
      <p>Draw a bbox by dragging on the canvas. This is a minimal demo.</p>
      <div style={{border:'1px solid #e5e7eb', width:800, height:600, background:'#fff'}}>
        <Stage
          width={800}
          height={600}
          onMouseDown={handleMouseDownStart}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          ref={stageRef}
        >
          <Layer>
            <URLImage src={DemoImage}/>
            {rects.map(r=>(
              <Rect key={r.id} x={r.x} y={r.y} width={r.width} height={r.height}
                stroke="red" strokeWidth={2} />
            ))}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}
