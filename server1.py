from aiohttp import web
import socketio

ROOM = '1234'

sio = socketio.AsyncServer(cors_allowed_origins='*', ping_timeout=35)
app = web.Application()
sio.attach(app)
socketToRoom={}


@sio.event
async def connect(sid, environ):
    print('Connected', sid)
    await sio.emit('ready', room=ROOM, skip_sid='sample@naver.com')
    sio.enter_room(sid, ROOM)
    
@sio.event
def disconnect(sid):
    sio.leave_room(sid, ROOM)
    print('Disconnected', sid)
    sio.emit('user_exit',{"id":sid},to=socketToRoom[sid])
    

@sio.event
async def join_room(sid,data):
    print(sid,data)
    socketToRoom[sid]=data["room"]
    
   
    await sio.emit(data["room"],to=sid)
    print(socketToRoom)
    
    usersInThisRoom=[]
    for id,email in socketToRoom.items():
        data={"id":id,"email":email}
        usersInThisRoom.append(data)
    
    await sio.emit("all_users",usersInThisRoom,to=sid)

@sio.event
async def offer(sid,data):
    #print("---->",data)
    await sio.emit('getOffer',{"sdp":data["sdp"],"offerSendID": data["offerSendID"], "offerSendEmail": data["offerSendEmail"]},to=data["offerReceiveID"])
    
@sio.event
async def answer(sid,data):
    await sio.emit('getAnswer',{"sdp": data["sdp"], "answerSendID": data["answerSendID"]},to=data["answerReceiveID"])

@sio.event
async def candidate(sid,data):
    await sio.emit('getCandidate',{"candidate": data["candidate"], "candidateSendID": data["candidateSendID"]},to=data["candidateReceiveID"])

    
    

if __name__ == '__main__':
    web.run_app(app, port=8080)
