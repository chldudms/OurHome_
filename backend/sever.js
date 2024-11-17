const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const app = express();
const PORT = 3000;

// SQLite database setup
const db = new sqlite3.Database('group.db', (err) => {
    if (err) {
        console.error('SQLite 연결 실패:', err);
    } else {
        console.log('SQLite 연결 성공');
    }
});

// Create tables if they don't exist
db.serialize(() => {
  // 그룹 테이블 생성 (만약 없다면)
    db.run(`
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            image TEXT
        )
    `);

    // 구역 테이블 생성 (만약 없다면)
    db.run(`
        CREATE TABLE IF NOT EXISTS zones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER,
            name TEXT NOT NULL,
            FOREIGN KEY (group_id) REFERENCES groups(id)
        )
    `);

    // 집안일 테이블 생성 (만약 없다면)
    db.run(`
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            zone_id INTEGER,
            name TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            FOREIGN KEY (zone_id) REFERENCES zones(id)
        )
    `);

    // 사용자 테이블 생성 (만약 없다면)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        reward INTEGER DEFAULT 0
    )`);

    // 기본 사용자 "나" 추가 (만약 없다면)
    db.get('SELECT id FROM users WHERE name = "나"', (err, row) => {
        if (err) {
            console.error('서버 오류: 사용자 조회 실패', err);
        }
        if (!row) {
            db.run('INSERT INTO users (name) VALUES ("나")', (err) => {
                if (err) {
                    console.error('서버 오류: 기본 사용자 추가 실패', err);
                } else {
                    console.log('기본 사용자 "나"가 추가되었습니다.');
                }
            });
        }
    });
});

// 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일을 서빙하기 위해 public 디렉토리를 설정
app.use(express.static(path.join(__dirname, 'public')));

// 파일 업로드 설정 (multer 사용)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Save uploaded files to 'uploads' folder
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Add timestamp to file name
    },
});

const upload = multer({ storage: storage });

// Routes for user registration and login
app.post('/join', (req, res) => {
    const { userName, userPW1, userPW2 } = req.body;

    if (userPW1 !== userPW2) {
        return res.send('<script>alert("비밀번호가 일치하지 않습니다."); window.location.href = "/";</script>');
    }

    const newUser = { userName, userPW: userPW1 };
    const usersFilePath = './users.json';

    fs.readFile(usersFilePath, 'utf-8', (err, data) => {
        let users = [];
        if (!err && data) {
            users = JSON.parse(data);
        }

        users.push(newUser);

        fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), (err) => {
            if (err) {
                return res.send('<script>alert("회원가입 중 오류가 발생했습니다."); window.location.href = "/";</script>');
            }
            res.redirect('/login');
        });
    });
});

app.post('/login', (req, res) => {
    const { userName, userPW } = req.body;
    const usersFilePath = './users.json';

    fs.readFile(usersFilePath, 'utf-8', (err, data) => {
        if (err) {
            return res.send('<script>alert("로그인 중 오류가 발생했습니다."); window.location.href = "/";</script>');
        }

        const users = JSON.parse(data);

        const user = users.find(u => u.userName === userName && u.userPW === userPW);

        if (user) {
            res.redirect('/AddGroup');
        } else {
            res.send('<script>alert("아이디 또는 비밀번호가 일치하지 않습니다."); window.location.href = "/login";</script>');
        }
    });
});

// 그룹 추가 API
app.post('/addGroup', upload.single('groupImage'), (req, res) => {
    const { groupName } = req.body;
    const groupImage = req.file ? `/uploads/${req.file.filename}` : '';

    if (!groupName || !groupImage) {
        return res.status(400).json({ message: '그룹 이름과 사진을 모두 제공해야 합니다.' });
    }

    db.run('INSERT INTO groups (name, image) VALUES (?, ?)', [groupName, groupImage], (err) => {
        if (err) {
            return res.status(500).json({ message: '서버 오류: 그룹 추가 실패' });
        }
        res.status(200).json({ message: '그룹이 추가되었습니다.' });
    });
});

// 그룹 목록과 구역 목록 가져오기 API
app.get('/groups', (req, res) => {
    db.all('SELECT * FROM groups', [], (err, groups) => {
        if (err) {
            return res.status(500).json({ message: '서버 오류: 그룹 목록 조회 실패' });
        }

        const groupIds = groups.map(group => group.id);
        const query = `SELECT * FROM zones WHERE group_id IN (${groupIds.join(',')})`;

        db.all(query, [], (err, zones) => {
            if (err) {
                return res.status(500).json({ message: '서버 오류: 구역 목록 조회 실패' });
            }

            const groupsWithZones = groups.map(group => {
                const groupZones = zones.filter(zone => zone.group_id === group.id);
                return {
                    ...group,
                    zones: groupZones,
                };
            });

            res.status(200).json({ groups: groupsWithZones });
        });
    });
});

// 구역 추가 API
app.post('/addZone', (req, res) => {
    const { zoneName, groupName } = req.body;

    if (!zoneName || !groupName) {
        return res.status(400).json({ message: '구역 이름과 그룹 이름을 모두 제공해야 합니다.' });
    }

    // 그룹 이름으로 그룹 ID 찾기
    db.get('SELECT id FROM groups WHERE name = ?', [groupName], (err, row) => {
        if (err) {
            return res.status(500).json({ message: '서버 오류: 그룹 조회 실패' });
        }
        if (!row) {
            return res.status(404).json({ message: '그룹을 찾을 수 없습니다.' });
        }

        const groupId = row.id;

        db.run('INSERT INTO zones (name, group_id) VALUES (?, ?)', [zoneName, groupId], (err) => {
            if (err) {
                return res.status(500).json({ message: '서버 오류: 구역 추가 실패' });
            }
            res.status(200).json({ message: `${zoneName} 구역이 추가되었습니다.` });
        });
    });
});

// 그룹 이름으로 구역 목록 가져오기 API
app.get('/zones/:groupName', (req, res) => {
    const groupName = req.params.groupName;

    db.get('SELECT * FROM groups WHERE name = ?', [groupName], (err, group) => {
        if (err) {
            return res.status(500).json({ message: '서버 오류: 그룹 조회 실패' });
        }
        if (!group) {
            return res.status(404).json({ message: '그룹을 찾을 수 없습니다.' });
        }

        db.all('SELECT * FROM zones WHERE group_id = ?', [group.id], (err, zones) => {
            if (err) {
                return res.status(500).json({ message: '서버 오류: 구역 목록 조회 실패' });
            }
            res.status(200).json({ zones });
        }); 
    });
});

// 집안일 추가 API
app.post('/addTask', (req, res) => {
  const { zoneName, taskName, taskReward, completeTask } = req.body;

  // 구역 이름과 집안일 이름이 제공되지 않으면 에러 반환
  if (!zoneName || !taskName) {
      return res.status(400).json({ message: '구역 이름과 집안일 이름을 모두 제공해야 합니다.' });
  }

  // 구역 이름으로 구역 ID 찾기
  db.get('SELECT id FROM zones WHERE name = ?', [zoneName], (err, row) => {
      if (err) {
          return res.status(500).json({ message: '서버 오류: 구역 조회 실패' });
      }
      if (!row) {
          return res.status(404).json({ message: '구역을 찾을 수 없습니다.' });
      }

      const zoneId = row.id;

      // 집안일 추가
      db.run('INSERT INTO tasks (name, reward, completed, zone_id) VALUES (?, ?, ?, ?)', [taskName, taskReward, completeTask, zoneId], (err) => {
          if (err) {
              return res.status(500).json({ message: '서버 오류: 집안일 추가 실패', error: err.message });
          }
          res.status(200).json({ message: `${zoneName}에 ${taskName} 집안일이 추가되었습니다. 보상:${taskReward}` });
      });
  });
});

// 구역에 해당하는 집안일 불러오기 API
app.get('/tasks/:zoneId', (req, res) => {
  const zoneId = req.params.zoneId;

  // 해당 구역 ID에 해당하는 집안일을 가져옴
  db.all('SELECT id, name, reward, completed FROM tasks WHERE zone_id = ?', [zoneId], (err, rows) => {
      if (err) {
          return res.status(500).json({ message: '서버 오류: 집안일 조회 실패' });
      }

      if (rows.length === 0) {
          return res.status(404).json({ message: '집안일이 없습니다.' });
      }

      res.status(200).json({ tasks: rows });
  });
});

// 집안일 삭제 API
app.delete('/deleteTask/:taskId', (req, res) => {
  const taskId = req.params.taskId;

  // 해당 taskId를 가진 집안일을 삭제
  db.run('DELETE FROM tasks WHERE id = ?', [taskId], (err) => {
      if (err) {
          return res.status(500).json({ message: '서버 오류: 집안일 삭제 실패' });
      }
      res.status(200).json({ message: '집안일이 삭제되었습니다.' });
  });
});

// 리워드 업데이트 API
app.post('/updateReward', (req, res) => {
  const { userName, taskReward } = req.body;

  // 사용자 이름으로 리워드 업데이트
  db.get('SELECT reward FROM users WHERE name = ?', [userName], (err, row) => {
      if (err) {
          return res.status(500).json({ message: '서버 오류: 사용자 조회 실패' });
      }
      if (!row) {
          return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
      }

      // 기존 리워드에 추가
      const newReward = row.reward + taskReward;

      // 리워드 업데이트
      db.run('UPDATE users SET reward = ? WHERE name = ?', [newReward, userName], (err) => {
          if (err) {
              return res.status(500).json({ message: '서버 오류: 리워드 업데이트 실패' });
          }
          res.status(200).json({ message: '리워드가 업데이트되었습니다.', newReward });
      });
  });
});

// 사용자의 리워드를 가져오는 API
app.get('/getReward/:userName', (req, res) => {
  const userName = req.params.userName;

  // 사용자 이름으로 리워드 조회
  db.get('SELECT reward FROM users WHERE name = ?', [userName], (err, row) => {
      if (err) {
          return res.status(500).json({ message: '서버 오류: 사용자 조회 실패' });
      }
      if (!row) {
          return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
      }

      // 리워드 반환
      res.status(200).json({ reward: row.reward });
  });
});

// 기본 페이지 (main.html) 서빙
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/AddGroup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Main.html'));
}); 

// 서버 시작
app.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT} 실행 중입니다.`);
});